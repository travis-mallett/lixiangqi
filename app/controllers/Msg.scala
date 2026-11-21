package controllers
package inbox

import play.api.libs.json.*
import play.api.data.Form
import play.api.data.Forms.*

import lila.app.{ *, given }
import lila.common.Json.given
import lila.msg.GlobalChat

final class Msg(env: Env) extends LilaController(env):

  private val boards = MsgBoards(env)

  def boardPreview = AuthOrScopedBodyWithParser(parse.json(52_000))(_.Web.Mobile, _.Mobile.Inbox) {
    ctx ?=> me ?=>
      boards.preview(ctx.body.body).map(board => Ok(Json.toJson(board)).noCache).recover {
        case lila.msg.MsgActionError("limited") => TooManyRequests(jsonError("limited"))
        case lila.msg.MsgActionError(code) => BadRequest(jsonError(code))
      }
  }

  def registerDevice = ScopedBody(parse.json(maxLength = 8192))(Seq(_.Mobile.Inbox)) { ctx ?=> me ?=>
    val device = (ctx.body.body \ "fid").asOpt[String].filter(_.matches("[a-zA-Z0-9_-]{22}"))
    val session = lila.common.HTTPRequest.bearer(ctx.req).map(lila.oauth.AccessToken.idFrom)
    (device, session) match
      case (Some(id), Some(key)) if !me.kid.yes =>
        env.push.registerInboxDevice(me, id, key.value).inject(NoContent)
      case _ => fuccess(BadRequest)
  }

  def unregisterDevice = Scoped(_.Mobile.Inbox) { ctx ?=> me ?=>
    lila.common.HTTPRequest
      .bearer(ctx.req)
      .so(b => env.push.unregisterInboxDevice(me, lila.oauth.AccessToken.idFrom(b).value).inject(NoContent))
  }

  def home(before: Option[Long] = None) = AuthOrScoped(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    before match
      case None =>
        negotiateApi(
          html = Ok.async(inboxJson(none).map(views.msg.home)).map(_.hasPersonalData),
          api = _ => JsonOk(inboxJson(none))
        )
      case Some(before) =>
        JsonOk:
          for
            threads <- env.msg.api.moreContacts(millisToInstant(before))
            contacts <- contactPage(threads, Some(millisToInstant(before)), env.msg.api.contactsPerPage)
          yield Json.obj("contacts" -> contacts)
  }

  def convo(username: UserStr, before: Option[Long] = None) = AuthOrScoped(_.Web.Mobile, _.Mobile.Inbox) {
    _ ?=> me ?=>
      if username.is(UserStr("new"))
      then Redirect(getUserStr("user").fold(routes.Msg.home())(routes.Msg.convo(_)))
      else
        env.msg.api
          .convoWithMe(username, before)
          .flatMap:
            case None => negotiate(Redirect(routes.Msg.home()), notFoundJson())
            case Some(c) =>
              def json = for
                mod <- inboxModerator
                inbox <- inboxJson(c.contact.id.some)
              yield inbox + ("convo" -> env.msg.json.convo(c).add("canModerate" -> mod))
              negotiateApi(
                html = Ok.async(json.map(views.msg.home)),
                api = _ => JsonOk(json)
              ).map(_.hasPersonalData)
  }

  def search(q: String) = AuthOrScoped(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    JsonOk:
      q.trim.nonEmptyOption match
        case None => env.msg.json.searchResult(env.msg.search.empty)
        case Some(q) => env.msg.search(q).flatMap(env.msg.json.searchResult)
  }

  def pendingDelivery = AuthOrScoped(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    JsonOk(env.msg.api.pendingDelivery).map(_.hasPersonalData)
  }

  def unreadCount = AuthOrScoped(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    JsonOk:
      env.msg.unreadCount.mobile(me)
  }

  def convoDelete(username: UserStr) = AuthOrScoped(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    env.msg.api.delete(username) >>
      JsonOk(inboxJson(none))
  }

  def apiPost(username: UserStr) = AuthOrScopedBody(_.Msg.Write, _.Mobile.Inbox) { ctx ?=> me ?=>
    if ctx.kid.yes && !ctx.isWebAuth then Forbidden(jsonError("rejected")).toFuccess
    else
      bindForm(sendForm)(
        doubleJsonFormError,
        data =>
          actionResult(
            env.msg.actions.send(
              username.id,
              data._1,
              data._2.getOrElse(scalalib.ThreadLocalRandom.nextString(24)),
              data._3,
              data._4,
              data._5.map(UserId(_)),
              data._6.toList.flatMap(_.split(',')).filter(_.nonEmpty),
              data._7,
              boards.resolve
            )
          )
      )
  }

  def messageAction(username: UserStr, id: String) = AuthOrScopedBody(_.Web.Mobile, _.Mobile.Inbox) {
    _ ?=> me ?=>
      bindForm(actionForm)(
        doubleJsonFormError,
        data =>
          actionResult(
            if data._1 == "remove" then
              inboxModerator.flatMap(mod => env.msg.actions.remove(username.id, id, data._3, mod))
            else
              env.msg.actions.update(
                username.id,
                id,
                data._1,
                data._2,
                data._3,
                data._4.orElse(data._5.contains(true).option("")).map(_.split(',').filter(_.nonEmpty).toList)
              )
          )
      )
  }

  def receipt(username: UserStr) = AuthOrScopedBody(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    bindForm(receiptForm)(
      doubleJsonFormError,
      data =>
        env.msg.actions
          .acknowledge(username.id, data._1.split(',').filter(_.nonEmpty).toList, data._2)
          .map(messages => Ok(Json.obj("receipts" -> messages.map(env.msg.json.receipt))))
          .recover { case _: lila.msg.MsgActionError => TooManyRequests(jsonError("limited")) }
    )
  }

  def typing(username: UserStr) = AuthOrScopedBody(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    bindForm(Form(single("active" -> play.api.data.Forms.boolean)))(
      doubleJsonFormError,
      active => env.msg.actions.typing(username.id, active) >> jsonOkResult
    )
  }

  private val sendForm = Form(
    tuple(
      "text" -> text(maxLength = 8000).transform[String](_.replace("\r\n", "\n"), identity),
      "nonce" -> optional(text(maxLength = 64)),
      "replyTo" -> optional(text(maxLength = 100)),
      "forwardId" -> optional(text(maxLength = 100)),
      "forwardUser" -> optional(text(maxLength = 100)),
      "attachments" -> optional(text(maxLength = 264)),
      "card" -> optional(text(maxLength = 48_000))
    )
  )
  private val actionForm = Form(
    tuple(
      "action" -> nonEmptyText(maxLength = 20),
      "value" -> text(maxLength = 8000),
      "revision" -> number(min = 0),
      "attachments" -> optional(text(maxLength = 264)),
      "replaceAttachments" -> optional(play.api.data.Forms.boolean)
    )
  )
  private val receiptForm = Form(
    tuple("ids" -> text(maxLength = 10000), "read" -> play.api.data.Forms.boolean)
  )

  private def actionResult(result: Fu[lila.msg.Msg]) =
    result.map(msg => Ok(Json.obj("ok" -> true, "msg" -> env.msg.json.renderMsg(msg)))).recover {
      case lila.msg.MsgActionError("notFound") => NotFound(jsonError("notFound"))
      case lila.msg.MsgActionError("unsafeLink") => UnprocessableEntity(jsonError("unsafeLink"))
      case lila.msg.MsgActionError("invalidBoard") => UnprocessableEntity(jsonError("invalidBoard"))
      case lila.msg.MsgActionError("conflict") | lila.core.security.SubmissionRejected("conflict") =>
        Conflict(jsonError("conflict"))
      case lila.core.security.SubmissionRejected(code) => UnprocessableEntity(jsonError(code))
      case lila.msg.MsgActionError("limited") => TooManyRequests(jsonError("limited"))
      case lila.msg.MsgActionError(code) => BadRequest(jsonError(code))
    }

  private def inboxJson(withConvo: Option[UserId])(using me: Me) =
    import lila.common.Json.lightUserWrites
    for
      threads <- env.msg.api.myThreads
      contactIds = withConvo.toList ::: threads.map(_.other)
      studentNames <- env.clas.api.clas.myPotentialStudentNames(contactIds)
      contacts <- contactPage(threads, None, env.msg.api.inboxSize)
      global <- me.kid.no.so(env.msg.globalChat.contact.map(List(_)))
      organization <- env.msg.organization.snapshot
    yield Json.obj(
      "me" -> Json.toJsObject(me.light).add("bot" -> me.isBot),
      "contacts" -> JsArray(global ++ contacts.value),
      "organization" -> organization,
      "names" -> studentNames
    )

  private def contactPage(threads: List[lila.msg.MsgThread], before: Option[Instant], max: Int)(using
      Me
  ): Fu[JsArray] = for
    directs <- env.msg.json.threadsJson(threads)
    groups <- env.msg.groups.contacts(before, max)
  yield
    if groups.isEmpty then directs
    else
      JsArray(
        (directs.value.toList.map(j => (j \ "lastMsg" \ "date").as[Long] -> j) ++ groups.map((at, j) =>
          at.toEpochMilli -> j
        )).sortBy(-_._1).take(max).map(_._2)
      )

  private val actionName = nonEmptyText(maxLength = 20)
  private val actionValue = default(text(maxLength = 480), "")
  private val actionMembers = default(text(maxLength = 16000), "")
  private val groupActionForm = Form(
    tuple("action" -> actionName, "value" -> actionValue, "members" -> actionMembers)
  )
  private val createGroupForm = Form(
    tuple("name" -> nonEmptyText(maxLength = 64), "members" -> nonEmptyText(maxLength = 16000))
  )
  private val organizationForm = Form(
    tuple(
      "chat" -> default(text(maxLength = 120), ""),
      "action" -> actionName,
      "value" -> actionValue,
      "members" -> actionMembers
    )
  )
  private def ids(raw: String) = raw.split(',').filter(_.nonEmpty).toList.distinct
  private def groupResult(result: Fu[play.api.mvc.Result]) = result.recover {
    case lila.msg.MsgActionError("notFound") => NotFound(jsonError("notFound"))
    case lila.msg.MsgActionError("limited") => TooManyRequests(jsonError("limited"))
    case lila.msg.MsgActionError("conflict") => Conflict(jsonError("conflict"))
    case lila.msg.MsgActionError(code) => UnprocessableEntity(jsonError(code))
    case lila.core.security.SubmissionRejected(code) => UnprocessableEntity(jsonError(code))
  }

  def collection(scope: String, before: Option[Long]) = AuthOrScoped(_.Web.Mobile, _.Mobile.Inbox) {
    _ ?=> me ?=>
      import lila.db.dsl.{ *, given }
      val at = before.map(millisToInstant)
      JsonOk:
        for
          ids <- env.msg.organization.selected(scope)
          (rooms, users) = ids.partition(lila.msg.MsgGroups.validId)
          threads <- env.msg.api.collectionThreads(users.map(UserId(_)), scope == "unread", at)
          directs <- env.msg.json.threadsJson(threads)
          selected = $inIds(rooms)
          groups <- env.msg.groups.contacts(
            at,
            50,
            if scope == "unread" then
              $or(
                selected,
                $doc(s"previews.${me.userId}.read" -> false, s"previews.${me.userId}.user".$ne(me.userId))
              )
            else selected
          )
          contacts = (directs.value.toList.map(j => (j \ "lastMsg" \ "date").as[Long] -> j) ++ groups.map(
            (at, j) => at.toEpochMilli -> j
          )).sortBy(-_._1).take(50)
        yield Json.obj(
          "contacts" -> contacts.map(_._2),
          "before" -> Option.when(contacts.size == 50)(contacts.last._1)
        )
  }

  def history(chat: String, q: String, files: Boolean, before: Option[Long], cursor: String) =
    AuthOrScoped(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
      groupResult(JsonOk(env.msg.actions.history(chat, q, files, before, cursor)))
    }

  def friends = AuthOrScoped(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    import lila.common.Json.lightUserWrites
    JsonOk(env.msg.groups.friends.map(users => Json.obj("friends" -> users)))
  }

  def organize = AuthOrScopedBody(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    bindForm(organizationForm)(
      doubleJsonFormError,
      (chat, action, value, members) =>
        groupResult(env.msg.organization.update(chat, action, value, ids(members)).map { data =>
          lila.common.Bus.pub(
            lila.core.socket.SendTo(
              me.userId,
              lila.core.socket.makeMessage("msgInbox", Json.obj("user" -> "", "organization" -> data))
            )
          )
          Ok(data)
        })
    )
  }

  def createGroup = AuthOrScopedBody(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    bindForm(createGroupForm)(
      doubleJsonFormError,
      (name, members) =>
        groupResult(
          env.msg.groups.create(name, ids(members).map(UserId(_))).map(id => Created(Json.obj("id" -> id)))
        )
    )
  }

  private def inboxModerator(using ctx: Context, me: Me): Fu[Boolean] =
    if me.kid.yes then fuFalse
    else if lila.core.perm.Granter(_.ChatTimeout) then fuTrue
    else if me.enabled.yes && me.totpSecret.nonEmpty && ctx.scopes.has(_.Mobile.ModerateGlobalChat) then
      env.user.repo.getRoles(me.userId).map(roles => lila.core.perm.Granter.ofDbKeys(_.ChatTimeout, roles))
    else fuFalse

  def group(id: String, before: Option[Long]) = AuthOrScoped(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    val room = if id == GlobalChat.id then
      inboxModerator.flatMap(env.msg.globalChat.conversation(before, _, getBool("compact")))
    else
      inboxModerator.flatMap(mod => env.msg.groups.conversation(id, before).map(_.add("canModerate" -> mod)))
    groupResult(room.flatMap { convo =>
      def data = if id == GlobalChat.id && getBool("compact") then
        fuccess(
          Json.obj(
            "me" -> Json.toJsObject(me.light).add("bot" -> me.isBot),
            "convo" -> convo,
            "contacts" -> Json.arr(),
            "names" -> Json.obj()
          )
        )
      else inboxJson(None).map(_ + ("convo" -> convo))
      negotiateApi(html = Ok.async(data.map(views.msg.home)), api = _ => JsonOk(data)).map(_.hasPersonalData)
    })
  }

  def globalPreview = Anon { ctx ?=>
    env.msg.globalChat.preview.map: (body, etag) =>
      val fresh = ctx.req.headers
        .get(IF_NONE_MATCH)
        .exists(_.split(",").exists(v => v.trim.stripPrefix("W/") == etag || v.trim == "*"))
      (if fresh then NotModified else Ok(body).as(JSON))
        .withHeaders(ETAG -> etag, CACHE_CONTROL -> "public, max-age=3")
  }

  def globalWatch = AuthOrScoped(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    env.msg.globalChat.watch
    fuccess(NoContent)
  }

  private def publicWrite[A](op: => Fu[A])(using me: Me) =
    env.chat.timeout
      .isActive(ChatId(GlobalChat.id), me.userId)
      .flatMap: active =>
        if active then fufail(lila.msg.MsgActionError("rejected")) else op

  def invitation(id: String, token: String) = AuthOrScoped(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    groupResult(env.msg.groups.inviteName(id, token).flatMap { name =>
      negotiateApi(
        html = Ok.page(views.msg.invitation(id, token, name)),
        api = _ => JsonOk(Json.obj("name" -> name))
      )
        .map(_.withHeaders(CACHE_CONTROL -> "private, no-store", "Referrer-Policy" -> "no-referrer"))
    })
  }

  def join(id: String, token: String) = AuthOrScopedBody(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    groupResult(env.msg.groups.join(id, token).flatMap { joined =>
      negotiateApi(
        html = if joined then fuccess(Redirect(s"/inbox/group/$id")) else Ok.page(views.msg.joinRequested),
        api = _ => JsonOk(Json.obj("joined" -> joined))
      )
    })
  }

  def groupManage(id: String) = AuthOrScopedBody(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    bindForm(groupActionForm)(
      doubleJsonFormError,
      (action, value, members) =>
        groupResult(
          env.msg.groups.manage(id, action, value, ids(members).map(UserId(_))) >> jsonOkResult
        )
    )
  }

  def groupPost(id: String) = AuthOrScopedBody(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    bindForm(sendForm)(
      doubleJsonFormError,
      d =>
        actionResult(
          if id == GlobalChat.id then
            publicWrite(
              env.msg.globalChat
                .send(
                  d._1,
                  d._2.getOrElse(""),
                  d._3,
                  d._6.toList.flatMap(ids),
                  d._5.zip(d._4),
                  d._7,
                  boards.resolve
                )
            )
          else
            env.msg.groups
              .send(
                id,
                d._1,
                d._2.getOrElse(""),
                d._3,
                d._6.toList.flatMap(ids),
                d._5.zip(d._4),
                d._7,
                boards.resolve
              )
        )
    )
  }

  def groupMessage(id: String, mid: String) = AuthOrScopedBody(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    bindForm(actionForm)(
      doubleJsonFormError,
      d =>
        actionResult(
          if id == GlobalChat.id then
            def update(moderator: Boolean) = env.msg.globalChat
              .update(mid, d._3, d._1, d._2, moderator, d._4.orElse(d._5.contains(true).option("")).map(ids))
            if Set("edit", "react", "vote", "endPoll")(d._1) then publicWrite(update(false))
            else inboxModerator.flatMap(update)
          else if d._1 == "remove" then
            inboxModerator.flatMap(mod => env.msg.groups.remove(id, mid, d._3, mod))
          else
            env.msg.groups
              .update(id, mid, d._1, d._2, d._3, d._4.orElse(d._5.contains(true).option("")).map(ids))
        )
    )
  }

  def groupReceipt(id: String) = AuthOrScopedBody(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    bindForm(receiptForm)(
      doubleJsonFormError,
      (raw, read) =>
        groupResult(JsonOk(if id == GlobalChat.id then env.msg.globalChat.acknowledge(ids(raw), read)
        else env.msg.groups.acknowledge(id, ids(raw), read)))
    )
  }

  def groupTyping(id: String) = AuthOrScopedBody(_.Web.Mobile, _.Mobile.Inbox) { _ ?=> me ?=>
    bindForm(Form(single("active" -> play.api.data.Forms.boolean)))(
      doubleJsonFormError,
      active =>
        groupResult(
          (if id == GlobalChat.id then publicWrite(env.msg.globalChat.typing(active))
           else env.msg.groups.typing(id, active)) >> jsonOkResult
        )
    )
  }
