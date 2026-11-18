package controllers
package report

import play.api.data.*
import play.api.mvc.{ AnyContentAsFormUrlEncoded, RequestHeader, Result }

import lila.app.{ *, given }
import lila.common.HTTPRequest
import lila.core.id.ReportId
import lila.report.ui.PendingCounts
import lila.report.Room.Scores
import lila.report.{ Mod as AsMod, Report as ReportModel, Reporter, Room, Suspect }

final class Report(env: Env, userC: => User, modC: => Mod) extends LilaController(env):

  import env.report.api

  private given Conversion[Me, AsMod] = me => AsMod(me)

  def list = Secure(_.SeeReport) { _ ?=> me ?=>
    if env.streamer.liveApi.isStreaming(me.user.id) && !getBool("force")
    then Forbidden.page(views.site.message.streamingMod)
    else renderList(env.report.modFilters.get(me).fold("all")(_.key))
  }

  def listWithFilter(room: String) = Secure(_.SeeReport) { _ ?=> me ?=>
    env.report.modFilters.set(me, Room(room))
    Room(room).forall(Room.isGranted).so(renderList(room))
  }

  protected[controllers] def getScores: Future[(Scores, PendingCounts)] = (
    api.maxScores,
    env.streamer.repo.countRequests,
    env.appeal.api.countUnread,
    env.title.api.countPending,
    env.memo.picfitApi.countFlagged
  ).mapN: (scores, streamers, appeals, titles, images) =>
    (scores, PendingCounts(streamers, appeals, titles, images))

  private def renderList(room: String)(using Context, Me) =
    api
      .openAndRecentWithFilter(12, Room(room))
      .zip(getScores)
      .zip(env.memo.attachments.scannerStatus)
      .flatMap { case ((reports, (scores, pending)), scanner) =>
        env.user.lightUserApi.preloadMany(reports.flatMap(_.report.userIds)) >>
          Ok.page:
            val filteredReports = reports.filter(r => lila.report.Room.isGranted(r.report.room))
            views.report.list(filteredReports, room, scores, pending, scanner)
      }

  def inquiry(reportOrAppealId: String) = Secure(_.SeeReport) { _ ?=> me ?=>
    for
      (prev, next) <- api.inquiries.toggle(reportOrAppealId, onlyOpen = getBool("onlyOpen"))
      appeal = prev.flatMap(p => p.appealTopic.map(p.user -> _))
    yield next.fold(
      Redirect(if appeal.isDefined then routes.Appeal.modQueue else routes.Report.list)
    )(onInquiryStart)
  }

  private def onInquiryStart(inquiry: ReportModel)(using RequestHeader): Result =
    if inquiry.isRecentComm then Redirect(routes.Mod.communicationPrivate(inquiry.user))
    else if inquiry.is(_.Comm) then Redirect(routes.Mod.communicationPublic(inquiry.user))
    else modC.redirect(inquiry.user)

  protected[controllers] def onModAction(goTo: Suspect)(using ctx: BodyContext[?], me: Me): Fu[Result] =
    if HTTPRequest.isXhr(ctx.req) then userC.renderModZoneActions(goTo.user.username)
    else
      api.inquiries
        .ofModId(me.id)
        .flatMap(_.fold(userC.modZoneOrRedirect(goTo.user.username))(onInquiryAction(_)))

  protected[controllers] def onInquiryAction(
      inquiry: ReportModel,
      processed: Boolean = false
  )(using ctx: BodyContext[?], me: Me): Fu[Result] =
    val dataOpt = ctx.body.body match
      case AnyContentAsFormUrlEncoded(data) => data.some
      case _ => none
    def thenGoTo: Option[String] =
      dataOpt
        .flatMap(_.get("then"))
        .flatMap(_.headOption)
        .flatMap:
          case "profile" => modC.userUrl(inquiry.user, mod = true).some
          case url => url.some
        .orElse(env.web.referrerRedirect.fromReq.map(_.value))
    def process() = (!processed).so(api.process(inquiry))
    thenGoTo match
      case Some(url) => process().inject(Redirect(url))
      case _ =>
        if inquiry.isAppeal then process() >> Redirect(routes.Appeal.modQueue)
        else if dataOpt.flatMap(_.get("next")).exists(_.headOption contains "1") then
          process() >> {
            if inquiry.isSpontaneous
            then Redirect(modC.userUrl(inquiry.user, mod = true))
            else
              api.inquiries
                .toggleNext(inquiry.room)
                .map:
                  case Some(next) => onInquiryStart(next)
                  case _ => Redirect(routes.Report.listWithFilter(inquiry.room.key))
          }
        else if processed then userC.modZoneOrRedirect(inquiry.user)
        else onInquiryStart(inquiry)

  def process(id: ReportId) = SecureBody(_.SeeReport) { _ ?=> me ?=>
    api
      .byId(id)
      .flatMap:
        _.fold(Redirect(routes.Report.list).toFuccess): inquiry =>
          for
            _ <- inquiry.appealTopic.so(env.appeal.api.setReadIfUnread(inquiry.user.id, _))
            _ <- api.process(inquiry)
            result <- onInquiryAction(inquiry, processed = true)
          yield result
  }

  def xfiles(id: ReportId) = SecureBody(_.SeeReport) { _ ?=> _ ?=>
    api
      .byId(id)
      .flatMap:
        _.fold(Redirect(routes.Report.list).toFuccess): inquiry =>
          api.moveToXfiles(id) >> onInquiryAction(inquiry, processed = true)
  }

  def snooze(id: ReportId, dur: String) = SecureBody(_.SeeReport) { _ ?=> _ ?=>
    api
      .snooze(id, dur)
      .map:
        _.fold(Redirect(routes.Report.list))(onInquiryStart)
  }

  def currentCheatInquiry(username: UserStr) = Secure(_.CheatHunter) { _ ?=> me ?=>
    Found(env.user.repo.byId(username)): user =>
      Found(api.currentCheatReport(lila.report.Suspect(user))): report =>
        api.inquiries.toggle(Left(report.id)).inject(NoContent)
  }

  def form = AuthOrScoped(_.Mobile.Inbox) { _ ?=> _ ?=>
    getUserStr("username").so(env.user.repo.byId).flatMap { user =>
      if user.exists(_.is(UserId.lichess)) then Redirect(routes.Main.contact)
      else
        Ok.async:
          val form = env.report.forms.create
          val filledForm: Form[lila.report.ReportSetup] = (user, get("postUrl")) match
            case (Some(u), Some(pid)) =>
              form.fill(lila.report.ReportSetup(u.light, reason = ~get("reason"), text = s"$pid\n\n"))
            case _ => form
          views.report.ui.form(filledForm, user, get("from"))
    }
  }

  private val reportRateLimit =
    env.security.ipTrust.rateLimit(30, 3.hours, "report.create", _.proxyMultiplier(3))

  def create = AuthOrScopedBody(_.Mobile.Inbox) { ctx ?=> me ?=>
    bindForm(env.report.forms.create)(
      err =>
        negotiate(
          html = for
            user <- getUserStr("username").so(env.user.repo.byId)
            page <- renderPage(views.report.ui.form(err, user, none))
          yield BadRequest(page),
          json = jsonFormError(err)
        ),
      data =>
        if me.is(data.user.id) then BadRequest("You cannot report yourself")
        else
          reportRateLimit(rateLimited):
            for
              _ <- api.create(data, Reporter(me), Nil)
              _ <- api.isAutoBlock(data).so(env.relation.api.block(me, data.user.id))
            yield
              if ctx.isOAuth then Ok(play.api.libs.json.Json.obj("ok" -> true))
              else Redirect(routes.Report.thanks).flashing("reported" -> data.user.name.value)
    )
  }

  private def inboxFormPage(user: lila.core.user.User, form: Form[?])(using Context, Me) = for
    msgs <- env.msg.api.msgsToReport(user.id)
    page <- renderPage(views.report.ui.inbox(form, user, msgs))
  yield (msgs, page)

  def inboxForm(username: UserStr) = Auth { _ ?=> _ ?=>
    Found(env.user.repo.byId(username)): user =>
      inboxFormPage(user, env.report.forms.create).map: (msgs, page) =>
        if msgs.nonEmpty then Ok(page)
        else Redirect(s"${routes.Report.form}?username=${user.username}")
  }

  def inboxCreate(username: UserStr) = AuthBody { _ ?=> me ?=>
    Found(env.user.repo.byId(username)): user =>
      bindForm(env.report.forms.create)(
        err => inboxFormPage(user, err).map((_, page) => BadRequest(page)),
        data =>
          for
            msgs <- env.msg.api.msgsToReport(data.user.id, data.msgs.some)
            _ <- api.create(data, Reporter(me), msgs.map(_.text))
            _ <- api.isAutoBlock(data).so(env.relation.api.block(me, data.user.id))
          yield Redirect(routes.Report.thanks).flashing("reported" -> data.user.name.value)
      )
  }

  def flag = AuthOrScopedBody(_.Web.Mobile, _.Mobile.Inbox, _.Mobile.Forum) { ctx ?=> me ?=>
    import lila.report.EvidenceItem
    bindForm(env.report.forms.flag)(
      _ => BadRequest,
      data =>
        Found(env.user.repo.byId(data.username)): user =>
          if user == me then BadRequest
          else if data.resource != "msg" && !data.resource.startsWith("forum/") && !data.resource.contains(
              "/forum/redirect/post/"
            )
          then
            if data.resource.startsWith("evidence/") || data.resource.exists(_.isWhitespace) then
              fuccess(BadRequest)
            else api.commFlag(Reporter(me), Suspect(user), data.resource, data.text).inject(jsonOkResult)
          else
            reportRateLimit(rateLimited):
              val item: Fu[Option[EvidenceItem]] =
                if data.resource == "msg" then
                  if ctx.isOAuth && !ctx.scopes.has(_.Mobile.Inbox) && !ctx.scopes.has(_.Web.Mobile) then
                    fuccess(None)
                  else
                    data.item.so(id => env.msg.actions.visibleMessage(user.id, id)).flatMapz { m =>
                      if m.user != user.id || !data.revision.contains(m.revision.toLong) then fuccess(None)
                      else
                        val maySeeMedia =
                          if m.attachments.isEmpty then fuFalse else env.msg.api.mediaAllowed(user.id, me)
                        maySeeMedia.map { allowed =>
                          Some(
                            EvidenceItem(
                              user.id,
                              "msg",
                              m.id,
                              m.revision,
                              m.text,
                              if allowed then m.attachments else Nil,
                              true,
                              "delivered"
                            )
                          )
                        }
                    }
                else if data.resource.startsWith("forum/") || data.resource.contains("/forum/redirect/post/")
                then
                  val id = data.resource.split('/').last
                  if ctx.kid.yes || (ctx.isOAuth && !ctx.scopes.has(_.Mobile.Forum)) then fuccess(None)
                  else
                    env.forum.postApi.get(ForumPostId(id)).flatMapz { (topic, post) =>
                      env.forum.access
                        .isGrantedRead(topic.categId)
                        .map: canRead =>
                          val revision = post.contentRevision.getOrElse(0L)
                          Option.when(
                            canRead && !post.erased && post.visibleBy(ctx.me) && post.userId
                              .contains(user.id) &&
                              (topic.categId != lila.forum.ForumCateg.diagnosticId || topic
                                .isAuthor(me) || isGranted(_.Diagnostics) || isGranted(_.ModerateForum)) &&
                              data.revision.contains(revision)
                          )(
                            EvidenceItem(
                              user.id,
                              "forum",
                              id,
                              revision,
                              post.text,
                              ~post.attachments,
                              topic.categId == lila.forum.ForumCateg.diagnosticId || post.isTeam,
                              "published"
                            )
                          )
                    }
                else fuccess(None)
              item.flatMap:
                case Some(i) if data.attachment.forall(i.attachments.contains) =>
                  val relevant = data.attachment.fold(i)(id => i.copy(attachments = List(id)))
                  for
                    _ <- (i.resource == "msg" && data.block.contains(true))
                      .so(env.relation.api.block(me, user.id))
                    e <- env.report.evidence.record(relevant)
                    _ <- api.commFlag(
                      Reporter(me),
                      Suspect(user),
                      s"evidence/${e.id}",
                      s"${i.resource} · ${i.status} ${data.text.take(100)}"
                    )
                  yield Ok(play.api.libs.json.Json.obj("ok" -> true))
                case _ => fuccess(NotFound)
    )
  }

  private def checkEvidence(
      id: String
  )(f: lila.report.Evidence => Fu[Result])(using Me, Context): Fu[Result] =
    env.report.evidence
      .get(id)
      .flatMap:
        case Some(e) if !e.item.privateItem || isGranted(_.ViewPrivateComms) =>
          api.inquiries
            .ofModId(summon[Me].userId)
            .flatMap:
              case Some(r) if r.user == e.item.suspect => f(e)
              case _ => fuccess(Forbidden)
        case _ => fuccess(NotFound)

  def evidence(id: String) = Secure(_.SeeReport) { ctx ?=> me ?=>
    checkEvidence(id): e =>
      get("media") match
        case Some(handle)
            if e.item.attachments.contains(
              handle
            ) || (e.item.status == "review requested" && e.item.parent == handle) =>
          env.memo.attachments
            .get(handle)
            .flatMap:
              case Some(i) =>
                val permitted = if i.audience.startsWith("msg/") then
                  env.msg.api.adultParticipants(i.owner, UserId(i.audience.drop(4)))
                else fuTrue
                permitted.flatMap:
                  case true =>
                    env.memo.attachments
                      .evidenceBytes(i, e.item.status == "review requested")
                      .map:
                        case Some(bytes) =>
                          Ok(bytes)
                            .as(if i.mime.contains("image/webp") then "image/webp"
                            else "application/octet-stream")
                            .withHeaders(
                              "Cache-Control" -> "private,no-store",
                              "Content-Disposition" -> (if i.mime.contains("image/webp") then "inline"
                                                        else "attachment"),
                              "X-Content-Type-Options" -> "nosniff",
                              "Content-Security-Policy" -> "sandbox"
                            )
                        case None => NotFound
                  case false => fuccess(NotFound)
              case _ => fuccess(NotFound)
        case _ =>
          val handles =
            if e.item.status == "review requested" then List(e.item.parent) else e.item.attachments
          handles
            .traverse(env.memo.attachments.get)
            .flatMap: items =>
              val images = items.flatten.filter(_.mime.contains("image/webp")).map(_.id).toSet
              Ok.page(views.report.evidence(e, images))
                .map(_.withHeaders("Cache-Control" -> "private,no-store"))
  }

  def resolveEvidence(id: String) = SecureBody(_.ViewPrivateComms) { ctx ?=> me ?=>
    checkEvidence(id): e =>
      if e.item.status != "review requested" then fuccess(BadRequest)
      else
        env.memo.attachments
          .resolveReview(e.item.parent, e.item.text, me, getBool("approve"))
          .flatMap:
            case true =>
              env.mod.logApi
                .attachmentReview(e.item.suspect, e.id, getBool("approve"))
                .inject(Redirect(routes.Report.evidence(id)))
            case false => fuccess(Conflict)
  }

  def thanks = Auth { ctx ?=> me ?=>
    ctx.req.flash
      .get("reported")
      .flatMap(UserStr.read)
      .fold(Redirect("/").toFuccess): reported =>
        Ok.async:
          env.relation.api
            .fetchBlocks(me, reported.id)
            .map:
              views.report.ui.thanks(reported.id, _)
  }
