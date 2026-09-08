package lila.user

import play.api.libs.json.*

import lila.common.Json.given
import lila.core.LightUser
import lila.core.perf.{ KeyedPerf, Perf, PuzPerf, UserPerfs }
import lila.core.user.{ LightPerf, LightRank, PlayTime, Profile }
import lila.core.rank.RankCode.*
import lila.rating.XiangqiRank
import lila.rating.UserPerfsExt.*

final class JsonView(isOnline: lila.core.socket.IsOnline) extends lila.core.user.JsonView:

  import JsonView.{ *, given }
  import lila.user.Profile.*

  def full(
      u: User,
      perfs: Option[UserPerfs | KeyedPerf],
      withProfile: Boolean
  ): JsObject =
    if u.enabled.no then disabled(u.light)
    else
      base(u, perfs) ++ Json
        .obj("createdAt" -> u.createdAt)
        .add(
          "profile" -> u.profile
            .ifTrue(withProfile)
            .map(p => Json.toJsObject(p.filterTroll(u.marks.troll)).noNull)
        )
        .add("seenAt" -> u.seenAt)
        .add("playTime" -> u.playTime)

  def roundPlayer(u: User, rank: Option[lila.core.rank.RankCode]) =
    if u.enabled.no then disabled(u.light)
    else
      base(u, none)
        .add("rank" -> rank.map(_.value))
        .add("online" -> isOnline.exec(u.id))

  def base(u: User, perfs: Option[UserPerfs | KeyedPerf]) =
    Json
      .obj(
        "id" -> u.id,
        "username" -> u.username,
        "perfs" -> perfs.fold(Json.obj()):
          case p: UserPerfs => perfsJson(p)
          case p: KeyedPerf => keyedPerfJson(p)
      )
      .add("title" -> u.title)
      .add("flair" -> u.flair)
      .add("tosViolation" -> u.lame)
      .add("patron" -> u.isPatron)
      .add("patronColor" -> u.patronAndColor.map(_.color))
      .add("verified" -> u.isVerified)

  def lightPerfIsOnline(lp: LightPerf) =
    lightPerfWrites.writes(lp).add("online" -> isOnline.exec(lp.user.id))

  def lightRankIsOnline(entry: LightRank): JsObject =
    Json
      .obj(
        "id" -> entry.user.id,
        "username" -> entry.user.name,
        "rank" -> entry.rank.value,
        "online" -> isOnline.exec(entry.user.id)
      )
      .add("title" -> entry.user.title)
      .add("patron" -> entry.user.isPatron)
      .add("patronColor" -> entry.user.patronAndColor.map(_.color))

  given lightPerfIsOnlineWrites: OWrites[LightPerf] = OWrites(lightPerfIsOnline)

  def disabled(u: LightUser) = Json.obj(
    "id" -> u.id,
    "username" -> u.name,
    "disabled" -> true
  )
  def ghost = disabled(LightUser.ghost)

object JsonView:

  given OWrites[Profile] = Json.writes
  given OWrites[PlayTime] = Json.writes

  given lightPerfWrites: OWrites[LightPerf] = OWrites[LightPerf]: l =>
    Json
      .obj(
        "id" -> l.user.id,
        "username" -> l.user.name,
        "perfs" -> Json.obj(
          l.perfKey.value -> Json.obj("rating" -> l.rating, "progress" -> l.progress)
        )
      )
      .add("title" -> l.user.title)
      .add("patron" -> l.user.isPatron)
      .add("patronColor" -> l.user.patronAndColor.map(_.color))

  given perfWrites: OWrites[Perf] = OWrites: o =>
    Json
      .obj(
        "games" -> o.nb,
        "rating" -> o.glicko.rating.toInt,
        "rd" -> o.glicko.deviation.toInt,
        "prog" -> o.progress
      )
      .add("prov", o.glicko.provisional)

  def keyedPerfJson(p: KeyedPerf): JsObject =
    if p.key == PerfKey.puzzle then Json.obj(p.key.value -> p.perf)
    else Json.obj()

  def perfsJson(p: UserPerfs): JsObject =
    Json
      .obj(
        "xiangqi" -> p.xiangqiRank.map: perf =>
          Json.obj(
            "games" -> perf.games,
            "rank" -> XiangqiRank.catalog.code(perf.score).value
          ),
        "puzzle" -> p.puzzle.nonEmpty.option(perfWrites.writes(p.puzzle))
      )
      .noNull
      .add("storm", p.storm.option)
      .add("racer", p.racer.option)
      .add("streak", p.streak.option)

  private given OWrites[PuzPerf] = OWrites: p =>
    Json.obj(
      "runs" -> p.runs,
      "score" -> p.score
    )

  def notes(ns: List[Note])(using lightUser: LightUserApi) =
    lightUser
      .preloadMany(ns.flatMap(_.userIds).distinct)
      .inject(JsArray:
        ns.map: note =>
          Json
            .obj(
              "from" -> lightUser.syncFallback(note.from),
              "to" -> lightUser.syncFallback(note.to),
              "text" -> note.text,
              "date" -> note.date
            )
            .add("mod", note.mod)
            .add("dox", note.dox))
