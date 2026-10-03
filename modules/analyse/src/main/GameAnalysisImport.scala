package lila.analyse

import chess.Ply
import chess.eval.Eval.{ Cp, Mate }
import play.api.libs.json.*

import lila.core.config.NetConfig
import lila.db.dsl.{ *, given }
import lila.tree.Analysis
import lila.xiangqi.{ Xiangqi, XiangqiRules }

/** Curator publication enters the same store and completion flow as Fishnet. */
final class GameAnalysisImport(
    repo: AnalysisRepo,
    analyser: Analyser,
    gameRepo: lila.core.game.GameRepo,
    net: NetConfig
)(using Executor):
  import GameAnalysisImport.*

  private def identifier(value: JsValue): Analysis.Id =
    val id = (value \ "id").as[String]
    (value \ "type").as[String] match
      case "native" =>
        require(id.matches("[A-Za-z0-9]{8}"), "Invalid native game ID")
        val origin = (value \ "origin").as[String]
        require(
          origin == net.baseUrl.value || origin == s"https://${net.prodDomain}",
          "Native analysis belongs to another site"
        )
        Analysis.Id(GameId(id))
      case "catalog" =>
        require(validCatalogId(id), "Invalid catalog game ID")
        Analysis.Id.Catalog(id)
      case _ => throw IllegalArgumentException("Invalid game source")

  def inventory(value: JsValue): Fu[JsObject] =
    val ids = value.as[List[JsObject]].map(identifier)
    require(ids.nonEmpty && ids.size <= 100, "Expected 1 to 100 game identities")
    for
      depths <- repo.depths(ids)
      nativeIds = ids.flatMap(_.gameId)
      ready <- nativeIds.nonEmpty.so(
        gameRepo.coll.primitive[GameId](
          $inIds(nativeIds) ++ $doc(lila.core.game.BSONFields.analysed -> true),
          "_id"
        )
      )
    yield
      // A crash between the analysis write and completion must be retried so
      // publication repairs metadata and delivers the normal completion events.
      val unfinished = nativeIds.toSet -- ready
      Json.obj("depths" -> depths.filterNot((id, _) => unfinished(GameId(id))))

  def apply(value: JsValue): Fu[Analysis] =
    val id = identifier((value \ "game").get)
    val fen = (value \ "initialFen").as[String]
    val moves = (value \ "moves").as[Vector[String]]
    require(moves.nonEmpty && moves.size <= 4096, "Invalid full-game move count")
    val position = Xiangqi.Position(
      fen,
      moves.map(m => Xiangqi.Uci.from(m).fold(e => throw IllegalArgumentException(e), identity))
    )
    val game = id match
      case Analysis.Id.Game(gameId) =>
        gameRepo
          .game(gameId)
          .orFail("Native game not found")
          .map: native =>
            require(native.finishedOrAborted, "Native game is not finished")
            require(
              native.xiangqi.initialFen == fen && native.xiangqi.moves == position.moves,
              "Analysis does not match the complete native game"
            )
            native.xiangqi
      case _ =>
        Future(XiangqiRules.game(position).fold(e => throw IllegalArgumentException(e), identity))
    game.flatMap: game =>
      val analysis = build(id, game, (value \ "positions").as[List[JsValue]])
      analyser
        .save(analysis, Array.emptyByteArray)
        .flatMap: _ =>
          repo.current(id).orFail("Published analysis missing")

object GameAnalysisImport:
  def validCatalogId(id: String): Boolean = id.matches("[A-Za-z0-9_:.-]{1,160}")

  private[analyse] def build(id: Analysis.Id, game: Xiangqi.Game, positions: List[JsValue]): Analysis =
    require(positions.size == game.moves.size + 1, "Analysis must cover every position")
    val evals = positions.zipWithIndex.map: (value, index) =>
      val state = game.states(index)
      if value == JsNull then
        require(index == positions.size - 1 && state.ended, "Missing nonterminal evaluation")
        Some(
          XiangqiAnalysis.Evaluation(
            Option.when(state.gameResult.winner.isEmpty)(Cp(0)),
            Option.when(state.gameResult.winner.isDefined)(Mate(0)),
            Nil,
            None
          )
        )
      else
        val depth = (value \ "depth").as[Int]
        require(depth > 0 && depth <= 255, "Invalid analysis depth")
        val cp = (value \ "cp").asOpt[Int].map(Cp.apply)
        val mate = (value \ "mate").asOpt[Int].map(Mate.apply)
        require(cp.isDefined != mate.isDefined, "Expected one exact score")
        val pv = (value \ "pv").as[List[String]]
        require(pv.size <= Info.LineMaxPlies, "Principal variation too long")
        val moves = pv.map(m => Xiangqi.Uci.from(m).fold(e => throw IllegalArgumentException(e), identity))
        require(
          state.ended || moves.headOption.exists(state.legalMoves.contains),
          "Missing or illegal best move"
        )
        Some(XiangqiAnalysis.Evaluation(cp, mate, moves, Some(depth)))
    // Terminal positions need no search. Every other position must establish depth.
    val depths = evals.zip(game.states).collect { case (Some(e), state) if !state.ended => e.depth.get }
    require(depths.nonEmpty, "No searched positions")
    val startPly = Ply(game.states.head.ply)
    Analysis(
      id,
      XiangqiAnalysis.infos(game, evals, startPly),
      startPly,
      game.position,
      nowInstant,
      None,
      None,
      Some(depths.min)
    )
