package controllers

import play.api.libs.json.*
import play.api.data.Form
import play.api.data.Forms.*

import lila.app.{ *, given }
import lila.common.Json.given

final class Msg(env: Env) extends LilaController(env):

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
            contacts <- env.msg.json.contacts(threads)
          yield contacts
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
              def json = inboxJson(c.contact.id.some).map { _ + ("convo" -> env.msg.json.convo(c)) }
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
              data._6.toList.flatMap(_.split(',')).filter(_.nonEmpty)
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
      "text" -> text(maxLength = 8000),
      "nonce" -> optional(text(maxLength = 64)),
      "replyTo" -> optional(text(maxLength = 100)),
      "forwardId" -> optional(text(maxLength = 100)),
      "forwardUser" -> optional(text(maxLength = 100)),
      "attachments" -> optional(text(maxLength = 264))
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
      case lila.core.security.SubmissionRejected(code) => UnprocessableEntity(jsonError(code))
      case lila.msg.MsgActionError("conflict") => Conflict(jsonError("conflict"))
      case lila.msg.MsgActionError("limited") => TooManyRequests(jsonError("limited"))
      case lila.msg.MsgActionError(code) => BadRequest(jsonError(code))
    }

  private def inboxJson(withConvo: Option[UserId])(using me: Me) =
    import lila.common.Json.lightUserWrites
    for
      threads <- env.msg.api.myThreads
      contactIds = withConvo.toList ::: threads.map(_.other)
      studentNames <- env.clas.api.clas.myPotentialStudentNames(contactIds)
      contacts <- env.msg.json.threadsJson(threads)
    yield Json.obj(
      "me" -> Json.toJsObject(me.light).add("bot" -> me.isBot),
      "contacts" -> contacts,
      "names" -> studentNames
    )
