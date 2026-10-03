package lila.study

import chess.format.pgn.Tags
import chess.format.Fen
import lila.xiangqi.Xiangqi.Uci

import lila.core.playerDirectory.PlayerId
import lila.xiangqi.Xiangqi.{ BySide, Side, GamePoints }
import lila.xiangqi.{ Xiangqi, XiangqiJson }
import XiangqiJson.given
import play.api.libs.json.*
import reactivemongo.api.bson.*

import lila.core.playerDirectory.Federation
import lila.db.dsl.{ *, given }

case class ChapterPreview(
    id: StudyChapterId,
    name: StudyChapterName,
    players: Option[BySide[ChapterPlayer]],
    orientation: Side,
    fen: Fen.Full,
    position: Xiangqi.Position,
    lastMove: Option[Uci],
    lastMoveAt: Option[Instant],
    check: Option[Chapter.Check],
    /* None = No Result PGN tag, the chapter may not be a game
     * Some(None) = Result PGN tag is "*", the game is new or ongoing
     * Some(Some(GamePoints)) = Game is over with a result
     */
    points: Option[Option[GamePoints]]
):
  def finished = points.exists(_.isDefined)
  def thinkTime = finished.not.so(lastMoveAt.map(at => (nowSeconds - at.toSeconds).toInt))
  def playerIds: List[PlayerId] = players.so(_.mapList(_.playerId)).flatten

final class ChapterPreviewApi(
    chapterRepo: ChapterRepo,
    federationsOf: Federation.FedsOf,
    cacheApi: lila.memo.CacheApi
)(using Federation.Guess, Executor):

  import ChapterPreview.AsJsons
  import ChapterPreview.json.given
  import ChapterPreview.bson.{ projection, given }

  object jsonList:
    // Can't be higher without skewing the clocks
    // because of Preview.secondsSinceLastMove
    private val cacheDuration = 1.second
    private[ChapterPreviewApi] val cache =
      cacheApi[StudyId, AsJsons](32, "study.chapterPreview.json"):
        _.expireAfterWrite(cacheDuration).buildAsyncFuture: studyId =>
          listAll(studyId).map(Json.toJson)

    def apply(studyId: StudyId): Fu[AsJsons] = cache.get(studyId)

    def withoutInitialEmpty(studyId: StudyId): Fu[AsJsons] =
      apply(studyId).map: json =>
        val singleInitial = json
          .asOpt[JsArray]
          .map(_.value)
          .filter(_.sizeIs == 1)
          .flatMap(_.headOption)
          .exists:
            case single: JsObject => single.str("name").contains("Chapter 1")
            case _ => false
        if singleInitial then JsArray.empty else json

  object dataList:
    private[ChapterPreviewApi] val cache =
      cacheApi[StudyId, List[ChapterPreview]](1024, "study.chapterPreview.data"):
        _.expireAfterWrite(1.minute).buildAsyncFuture(listAll)

    def apply(studyId: StudyId): Fu[List[ChapterPreview]] = cache.get(studyId)

  def firstId(studyId: StudyId): Fu[Option[StudyChapterId]] =
    jsonList(studyId).map(ChapterPreview.json.readFirstId)

  private def listAll(studyId: StudyId): Fu[List[ChapterPreview]] =
    for
      withoutFeds <- chapterRepo.coll:
        _.find(chapterRepo.$studyId(studyId), projection.some)
          .sort(chapterRepo.$sortOrder)
          .cursor[ChapterPreview]()
          .listAll()
      federations <- federationsOf(withoutFeds.flatMap(_.playerIds))
    yield withoutFeds.map: chap =>
      chap.copy(
        players = chap.players.map:
          _.map: player =>
            player.copy(fed = player.fed orElse player.playerId.flatMap(federations.get))
      )

  def fromChapter(chapter: Chapter)(using Federation.Guess) =
    import chapter.*
    ChapterPreview(
      id = id,
      name = name,
      players = ChapterPlayer.fromTags(tags, denorm.so(_.clocks)),
      orientation = setup.orientation,
      fen = denorm.fold(root.fen)(_.fen),
      position = denorm.fold(Xiangqi.Position(root.fen.value, ruleset = root.ruleset))(_.position),
      lastMove = denorm.flatMap(_.uci),
      lastMoveAt = relay.flatMap(_.lastMoveAt),
      check = denorm.flatMap(_.check),
      points = tags("Result").map(GamePoints.fromResult)
    )

  def invalidate(studyId: StudyId): Unit =
    jsonList.cache.synchronous().invalidate(studyId)
    dataList.cache.synchronous().invalidate(studyId)

object ChapterPreview:

  type AsJsons = JsValue

  object json:
    import lila.common.Json.given
    import StudyPlayer.json.given

    def readFirstId(js: AsJsons): Option[StudyChapterId] = for
      arr <- js.asOpt[JsArray]
      obj <- arr.value.headOption
      id <- obj.get[StudyChapterId]("id")
    yield id

    private given Writes[Chapter.Check] = Writes:
      case Chapter.Check.Check => JsString("+")
      case Chapter.Check.Mate => JsString("#")

    given OWrites[ChapterPreview] = OWrites: c =>
      Json
        .obj(
          "id" -> c.id,
          "name" -> c.name,
          "position" -> c.position
        )
        .add("fen", Option.when(c.fen.value != Xiangqi.startFen)(c.fen))
        .add("players", c.players.map(_.toList))
        .add("orientation", c.orientation.some.filter(_.black))
        .add("lastMove", c.lastMove)
        .add("check", c.check)
        .add("thinkTime", c.thinkTime)
        .add("status", c.points.map(o => GamePoints.show(o).replace("1/2", "½")))

  object bson:
    import BSONHandlers.given

    val projection = $doc(
      "name" -> true,
      "denorm" -> true,
      "tags" -> true,
      "lastMoveAt" -> "$relay.lastMoveAt",
      "orientation" -> "$setup.orientation",
      "rootFen" -> "$root._.f",
      "ruleset" -> "$root._.ruleset"
    )

    given (using Federation.Guess): BSONDocumentReader[ChapterPreview] =
      BSONDocumentReader.option[ChapterPreview]: doc =>
        for
          id <- doc.getAsOpt[StudyChapterId]("_id")
          name <- doc.getAsOpt[StudyChapterName]("name")
          lastMoveAt = doc.getAsOpt[Instant]("lastMoveAt")
          lastPos = doc.getAsOpt[Chapter.LastPosDenorm]("denorm")
          tags = doc.getAsOpt[Tags]("tags")
          orientation = doc.getAsOpt[Side]("orientation").get
        yield ChapterPreview(
          id = id,
          name = name,
          players = tags.flatMap(ChapterPlayer.fromTags(_, lastPos.so(_.clocks))),
          orientation = orientation,
          fen = lastPos
            .map(_.fen)
            .orElse(doc.getAsOpt[Fen.Full]("rootFen"))
            .getOrElse(throw IllegalArgumentException("Missing study preview initial position")),
          position = lastPos
            .map(_.position)
            .getOrElse(
              Xiangqi.Position(
                doc.getAsOpt[Fen.Full]("rootFen").get.value,
                ruleset = doc.getAsOpt[lila.xiangqi.adjudication.Ruleset]("ruleset").get
              )
            ),
          lastMove = lastPos.flatMap(_.uci),
          lastMoveAt = lastMoveAt,
          check = lastPos.flatMap(_.check),
          points = tags.flatMap(_("Result")).map(GamePoints.fromResult)
        )
