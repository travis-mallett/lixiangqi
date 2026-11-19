package lila.msg

import com.softwaremill.macwire.*

import lila.common.Bus
import lila.common.autoconfig.given
import lila.common.Json.given
import lila.core.config.*
import lila.core.socket.remote.TellUserIn

@Module
final class Env(
    appConfig: play.api.Configuration,
    baseUrl: BaseUrl,
    db: lila.db.Db,
    lightUserApi: lila.core.user.LightUserApi,
    isOnline: lila.core.socket.IsOnline,
    userApi: lila.core.user.UserApi,
    userRepo: lila.core.user.UserRepo,
    userCache: lila.core.user.CachedApi,
    relationApi: lila.core.relation.RelationApi,
    prefApi: lila.core.pref.PrefApi,
    notifyApi: lila.core.notify.NotifyApi,
    ircApi: lila.core.irc.IrcApi,
    cacheApi: lila.memo.CacheApi,
    reportApi: lila.core.report.ReportApi,
    shutupApi: lila.core.shutup.ShutupApi,
    spam: lila.core.security.SpamApi,
    textAnalyser: lila.core.shutup.TextAnalyser,
    attachments: lila.memo.Attachments,
    mongoCache: lila.memo.MongoCache.Api
)(using
    Executor,
    Scheduler,
    org.apache.pekko.stream.Materializer,
    lila.core.i18n.Translator,
    lila.core.config.RateLimit
):

  private val colls = wire[MsgColls]

  private val contactApi = ContactApi(userRepo.coll)

  val json = wire[MsgJson]

  val organization = wire[MsgOrganization]

  private val notifier = wire[MsgNotify]

  private val security = wire[MsgSecurity]

  private val media = wire[MsgMedia]

  val api: MsgApi = wire[MsgApi]

  val globalChat = wire[GlobalChat]

  val groups = wire[MsgGroups]

  val actions = wire[MsgActions]

  val search = wire[MsgSearch]

  val unreadCount = wire[MsgUnreadCount]

  val systemMsg = wire[MsgByLichess]

  lila.common.Cli.handle:
    case "msg" :: "multi" :: orig :: dests :: words =>
      api.cliMultiPost(
        UserStr(orig),
        UserId.from(dests.map(_.toLower).split(',').toIndexedSeq),
        words.mkString(" ")
      )

  Bus.sub[lila.core.msg.SystemMsg]:
    case lila.core.msg.SystemMsg(userId, text) =>
      api.systemPost(userId, text)

  private val payoutsUrl = appConfig.get[Url]("payouts.portal")

  Bus.sub[lila.core.msg.PayoutMessages]: p =>
    p.userIds.foreach: userId =>
      api.postPreset(userId, MsgPreset.payoutEligible(payoutsUrl, p))

  Bus.sub[lila.core.user.SetKidMode]: change =>
    if change.user.kid.yes then
      groups.revokeMedia(change.user.id)
      attachments
        .privateContacts(change.user.id)
        .foreach: peers =>
          peers
            .filterNot(p => MsgGroups.validId(p.value))
            .foreach(p =>
              Bus.pub(
                lila.core.socket.SendTo(
                  p,
                  lila.core.socket
                    .makeMessage("msgMediaRevoked", play.api.libs.json.Json.obj("user" -> change.user.id))
                )
              )
            )

  Bus.sub[TellUserIn]:
    case TellUserIn.Read(userId, msg) =>
      msg.get[UserId]("d").foreach { api.setRead(userId, _) }
    case TellUserIn.Send(userId, msg) =>
      for
        obj <- msg.obj("d")
        dest <- obj.get[UserId]("dest")
        text <- obj.str("text")
      yield
        val result = if obj.keys.contains("attachments") then fuccess(Some("attachmentsUnavailable"))
        else api.post(userId, dest, text).map(_.rejection)
        result
          .recover { case lila.core.security.SubmissionRejected(code) => Some(code) }
          .foreach:
            _.foreach: code =>
              Bus.pub(
                lila.core.socket.SendTo(
                  userId,
                  lila.core.socket.makeMessage(
                    "msgSendFailed",
                    play.api.libs.json.Json.obj("user" -> dest, "error" -> code)
                  )
                )
              )

  Bus.sub[lila.core.mod.ChatTimeout]: to =>
    systemMsg.chatTimeout(to.user)

private class MsgColls(db: lila.db.Db)(using Executor):
  val group = db(CollName("msg_group"))
  val organization = db(CollName("msg_organization"))
  val thread = db(CollName("msg_thread"))
  val msg = db(CollName("msg_msg"))
  lazy val mailboxIndexes: Funit =
    import reactivemongo.api.indexes.{ Index, IndexType }
    group.indexesManager
      .ensure(Index(Seq("users" -> IndexType.Ascending, "updatedAt" -> IndexType.Descending)))
      .void >>
      organization.indexesManager.ensure(Index(Seq("owner" -> IndexType.Ascending))).void >>
      organization.indexesManager
        .ensure(Index(Seq("chat" -> IndexType.Ascending, "mute" -> IndexType.Ascending)))
        .void

  lazy val globalIndex: Funit =
    import reactivemongo.api.indexes.{ Index, IndexType }
    import lila.db.dsl.{ *, given }
    msg.indexesManager
      .ensure(
        Index(
          Seq("tid" -> IndexType.Ascending, "date" -> IndexType.Descending, "_id" -> IndexType.Descending),
          partialFilter = Some($doc("tid" -> GlobalChat.id))
        )
      )
      .void

  lazy val deliveryIndex: Funit =
    import reactivemongo.api.indexes.{ Index, IndexType }
    import lila.db.dsl.{ *, given }
    msg.indexesManager
      .ensure(
        Index(
          Seq("deliveryTo" -> IndexType.Ascending, "date" -> IndexType.Ascending),
          partialFilter = Some($doc("deliveryTo".$exists(true)))
        )
      )
      .void

  // Additive index, installed once before pin queries. No message data is rewritten.
  lazy val pinnedIndex: Funit =
    import reactivemongo.api.indexes.{ Index, IndexType }
    import lila.db.dsl.{ *, given }
    msg.indexesManager
      .ensure(
        Index(
          Seq("tid" -> IndexType.Ascending, "pinnedAt" -> IndexType.Descending),
          name = Some("msg_pinned"),
          partialFilter = Some($doc("pinnedAt".$exists(true)))
        )
      )
      .void
