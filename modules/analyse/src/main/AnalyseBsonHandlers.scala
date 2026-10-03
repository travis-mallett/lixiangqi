package lila.analyse

import chess.Ply
import reactivemongo.api.bson.*

import lila.db.BSON
import lila.db.dsl.given
import lila.tree.{ Analysis, Info }

object AnalyseBsonHandlers:
  private given BSONHandler[lila.xiangqi.Xiangqi.Uci] = lila.db.dsl.tryHandler(
    { case BSONString(value) => scala.util.Try(lila.xiangqi.Xiangqi.Uci.unsafe(value)) },
    move => BSONString(move.value)
  )
  private given BSONHandler[lila.xiangqi.adjudication.Ruleset] = lila.db.dsl.tryHandler(
    { case BSONString(value) =>
      lila.xiangqi.adjudication.Ruleset
        .fromKey(value)
        .left
        .map(error => new IllegalArgumentException(error))
        .toTry
    },
    ruleset => BSONString(ruleset.key)
  )
  private given BSONDocumentHandler[lila.xiangqi.Xiangqi.Position] = Macros.handler

  given BSONWriter[Analysis.Id] = BSONWriter(id => BSONString(id.value))

  given BSON[Analysis] with
    def reads(r: BSON.Reader) =
      require(
        r.str("moveFormat") == "xiangqi-uci-v1",
        "Unsupported analysis move format; run the versioned migration"
      )
      val startPly = Ply(r.intD("ply"))
      val raw = r.str("data")
      def id =
        def getId[Id: BSONReader]: Id = r.get[Id]("_id")
        r.getO[StudyId]("studyId") match
          case Some(studyId) => Analysis.Id(studyId, r.get[StudyChapterId]("chapterId"))
          case None =>
            val value = r.str("_id")
            if value.startsWith("catalog:") then Analysis.Id.Catalog(value.stripPrefix("catalog:"))
            else Analysis.Id(getId[GameId])
      Analysis(
        id = id,
        infos = Info.decodeList(raw, startPly).err(s"Invalid analysis data $raw"),
        startPly = startPly,
        position = r.get[lila.xiangqi.Xiangqi.Position]("position"),
        date = r.date("date"),
        fk = r.strO("fk"),
        nodesPerMove = r.intO("npm"),
        depth = r.intO("depth")
      )
    def writes(w: BSON.Writer, a: Analysis) =
      BSONDocument(
        "_id" -> a.id,
        "studyId" -> a.studyId,
        "chapterId" -> a.id.chapterId,
        "data" -> Info.encodeList(a.infos),
        "moveFormat" -> "xiangqi-uci-v1",
        "ply" -> w.intO(a.startPly.value),
        "position" -> a.position,
        "date" -> w.date(a.date),
        "fk" -> a.fk,
        "npm" -> a.nodesPerMove,
        "depth" -> a.depth
      )

  given engineHandler: BSONDocumentHandler[ExternalEngine] = Macros.handler
