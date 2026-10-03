package lila.study

import lila.xiangqi.XiangqiGlyph.{ Glyph, Glyphs }

import lila.xiangqi.Xiangqi.Square
import lila.xiangqi.XiangqiJson.given
import play.api.libs.json.*

import lila.common.Json.{ *, given }
import lila.core.i18n.Translate
import lila.core.socket.Sri
import lila.tree.Node.Shape
import lila.core.pref.Pref
import lila.xiangqi.{ Xiangqi, XiangqiRules }

final class JsonView(
    studyRepo: StudyRepo,
    lightUserApi: lila.core.user.LightUserApi
)(using Executor):

  import JsonView.given

  def full(
      study: Study,
      chapter: Chapter,
      previews: Option[ChapterPreview.AsJsons],
      withMembers: Boolean,
      analysis: ChapterAnalysis.Result
  )(using me: Option[Me], pref: Pref) =

    def allowed(selection: Settings => Settings.UserSelection): Boolean =
      Settings.UserSelection.allows(selection(study.settings), study, me.map(_.userId))

    for
      liked <- me.so(studyRepo.liked(study, _))
      relayPath = chapter.relay
        .filter(_.secondsSinceLastMove.exists(_ < 3600) || StudyPgnTags.points(chapter.tags).isEmpty)
        .map(_.path)
        .filterNot(_.isEmpty)
      jsStudy =
        if withMembers || me.exists(study.canContribute) then study
        else study.copy(members = StudyMembers.empty)
    yield Json.toJsObject(jsStudy) ++ Json
      .obj(
        "liked" -> liked,
        "features" -> Json
          .obj(
            "cloneable" -> allowed(_.cloneable),
            "shareable" -> allowed(_.shareable),
            "chat" -> allowed(_.chat)
          )
          .add("sticky", study.settings.sticky)
          .add("description", study.settings.description),
        "topics" -> study.topicsOrEmpty,
        "chapter" -> Json
          .obj(
            "id" -> chapter.id,
            "name" -> chapter.name,
            "ownerId" -> chapter.ownerId,
            "setup" -> chapter.setup,
            "tags" -> chapter.tagsExport,
            "features" -> Json.obj(
              "computer" -> allowed(_.computer),
              "explorer" -> allowed(_.explorer)
            )
          )
          .add("description", chapter.description)
          .add("serverEval", JsonView.chapterServerEval(chapter, analysis))
          .add("relayPath", relayPath)
          .pipe(addChapterMode(chapter))
      )
      .add("chapters", previews)
      .add("description", study.description)
      .add("showRatings", pref.showRatings)

  def chapterConfig(c: Chapter) =
    Json
      .obj(
        "id" -> c.id,
        "name" -> c.name,
        "orientation" -> c.setup.orientation
      )
      .add("description", c.description)
      .pipe(addChapterMode(c))

  def pagerData(s: Study.WithChaptersAndLiked) =
    Json
      .obj(
        "id" -> s.study.id,
        "name" -> s.study.name,
        "liked" -> s.liked,
        "likes" -> s.study.likes,
        "updatedAt" -> s.study.updatedAt,
        "owner" -> lightUserApi.sync(s.study.ownerId),
        "chapters" -> s.chapters.take(Study.previewNbChapters),
        "topics" -> s.study.topicsOrEmpty,
        "members" -> s.study.members.members.values.take(Study.previewNbMembers)
      )
      .add("flair", s.study.flair)

  private def addChapterMode(c: Chapter)(js: JsObject): JsObject =
    js.add("practice", c.isPractice)
      .add("gamebook", c.isGamebook)
      .add("conceal", c.conceal)

  private[study] given Writes[StudyMember.Role] = Writes: r =>
    JsString(r.id)
  private[study] given Writes[StudyMember] = Writes: m =>
    Json.obj("user" -> lightUserApi.syncFallback(m.id), "role" -> m.role)

  private[study] given Writes[StudyMembers] = Writes: m =>
    Json.toJson(m.members)

  private given OWrites[Study] = OWrites: s =>
    Json
      .obj(
        "id" -> s.id,
        "name" -> s.name,
        "members" -> s.members,
        "position" -> s.position,
        "ownerId" -> s.ownerId,
        "settings" -> s.settings,
        "visibility" -> s.visibility,
        "createdAt" -> s.createdAt,
        "secondsSinceUpdate" -> (nowSeconds - s.updatedAt.toSeconds).toInt,
        "from" -> s.from,
        "likes" -> s.likes
      )
      .add("isNew" -> s.isNew)
      .add("flair" -> s.flair)

object JsonView:

  case class JsData(study: JsObject, analysis: JsObject)

  def analysisTree(chapter: Chapter, resolved: ChapterAnalysis.Result): JsValue =
    import lila.tree.evals.jsonWrites
    val infos = if resolved.sourceGame.isEmpty then Map.empty[Int, lila.tree.Eval]
    else resolved.analysis.toList.flatMap(_.infos).map(info => info.ply.value -> info.eval).toMap
    val mainline =
      java.util.Collections.newSetFromMap(new java.util.IdentityHashMap[lila.tree.Node, java.lang.Boolean]())
    chapter.root.mainline.foreach(mainline.add)
    lila.tree.Node.writeJson(
      chapter.root,
      node =>
        node.eval
          .filterNot(_.isEmpty)
          .map(e => Json.toJson(e).as[JsObject])
          .orElse(
            Option
              .when(mainline.contains(node))(infos.get(node.ply.value))
              .flatten
              .filterNot(_.isEmpty)
              .map(e => Json.toJson(e).as[JsObject] + ("sourceGame" -> JsBoolean(true)))
          )
    )

  private[study] def chapterServerEval(chapter: Chapter, resolved: ChapterAnalysis.Result): Option[JsObject] =
    resolved.sourceGame
      .map: id =>
        Json.obj("done" -> true, "path" -> chapter.root.mainlinePath, "sourceGame" -> id)
      .orElse(chapter.serverEval.filter(_.path == chapter.root.mainlinePath).map(Json.toJsObject(_)))

  given OWrites[lila.core.study.IdName] = Json.writes

  def metadata(study: Study) = Json.obj(
    "id" -> study.id,
    "name" -> study.name,
    "createdAt" -> study.createdAt,
    "updatedAt" -> study.updatedAt
  )

  def glyphs(using Translate): JsObject =
    import lila.core.i18n.I18nKey.study as trans

    import Glyph.MoveAssessment.*
    import Glyph.PositionAssessment.*
    import Glyph.Observation.*
    Json.obj(
      "move" -> List(
        good.withName(trans.goodMove.txt()),
        mistake.withName(trans.mistake.txt()),
        brilliant.withName(trans.brilliantMove.txt()),
        blunder.withName(trans.blunder.txt()),
        interesting.withName(trans.interestingMove.txt()),
        dubious.withName(trans.dubiousMove.txt()),
        only.withName(trans.onlyMove.txt()),
        zugzwang.withName(trans.zugzwang.txt())
      ),
      "position" -> List(
        equal.withName(trans.equalPosition.txt()),
        unclear.withName(trans.unclearPosition.txt()),
        redSlightlyBetter.withName(trans.redIsSlightlyBetter.txt()),
        blackSlightlyBetter.withName(trans.blackIsSlightlyBetter.txt()),
        redQuiteBetter.withName(trans.redIsBetter.txt()),
        blackQuiteBetter.withName(trans.blackIsBetter.txt()),
        redMuchBetter.withName(trans.redIsWinning.txt()),
        blackMuchBetter.withName(trans.blackIsWinning.txt())
      ),
      "observation" -> List(
        novelty.withName(trans.novelty.txt()),
        development.withName(trans.development.txt()),
        initiative.withName(trans.initiative.txt()),
        attack.withName(trans.attack.txt()),
        counterplay.withName(trans.counterplay.txt()),
        timeTrouble.withName(trans.timeTrouble.txt()),
        compensation.withName(trans.withCompensation.txt()),
        withIdea.withName(trans.withTheIdea.txt())
      )
    )

  private[study] given Writes[Sri] = writeAs(_.value)
  private[study] given Writes[lila.core.study.Visibility] = writeAs(_.toString)
  private[study] given Writes[Study.From] = Writes:
    case Study.From.Scratch => JsString("scratch")
    case Study.From.Game(id) => Json.obj("game" -> id)
    case Study.From.Study(id) => Json.obj("study" -> id)
    case Study.From.Relay(id) => Json.obj("relay" -> id)
  private[study] given Writes[Settings.UserSelection] = Writes(v => JsString(v.key))
  private[study] given Writes[Settings] = Json.writes

  given Writes[chess.format.pgn.Tag] = Writes: t =>
    Json.arr(t.name.toString, t.value)
  given Writes[chess.format.pgn.Tags] = Writes: tags =>
    JsArray(tags.value.map(Json.toJson))
  private given OWrites[Chapter.Setup] = Json.writes

  private[study] given Writes[Position.Ref] = Json.writes
  private[study] given Writes[Study.Liking] = Json.writes

  given OWrites[Chapter.Relay] = OWrites: r =>
    Json.obj(
      "path" -> r.path,
      "thinkTime" -> r.secondsSinceLastMove
    )

  private[study] given OWrites[Chapter.ServerEval] = Json.writes

  private[study] given OWrites[Who] = OWrites: w =>
    Json.obj("u" -> w.u, "s" -> w.sri)
