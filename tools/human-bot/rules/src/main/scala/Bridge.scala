package lila.xiangqi

import scala.scalajs.js
import scala.scalajs.js.annotation.*
import scala.scalajs.js.JSConverters.*

import Xiangqi.*
import adjudication.Ruleset

/** Opaque immutable games preserve the canonical history-sensitive adjudicator. */
@JSExportTopLevel("XiangqiRules")
object HumanBotBridge:
  private def checked[A](value: Either[String, A]): A =
    value.fold(error => throw IllegalArgumentException(error), identity)

  @JSExport def initial(fen: String, ruleset: String): js.Any =
    val policy = checked(Ruleset.fromKey(ruleset))
    require(policy == Ruleset.Tiantian || policy == Ruleset.Unrestricted, "Standard xiangqi adapter only")
    val game = checked(XiangqiRules.initialGame(Some(fen), policy))
    require(game.variant == GameVariant.Xiangqi, "Standard xiangqi position required")
    game.asInstanceOf[js.Any]

  @JSExport def play(handle: js.Any, move: String): js.Any =
    val game = handle.asInstanceOf[Game]
    checked(XiangqiRules.move(game, checked(Uci.from(move))).flatMap(game.applyMove)).asInstanceOf[js.Any]

  @JSExport def inspect(handle: js.Any): js.Object =
    val game = handle.asInstanceOf[Game]
    val state = game.state
    val board = Fen.board(state.fen).get
    js.Dynamic.literal(
      fen = state.fen,
      ruleset = game.ruleset.key,
      ply = state.ply,
      turn = state.turn.key,
      moves = state.legalMoves.map(_.value).toJSArray,
      check = state.check,
      result = state.gameResult.key,
      termination = state.termination.fold[js.Any](null)(identity),
      pieces = board.pieces.toVector
        .sortBy(_._1.key)
        .map((square, piece) =>
          js.Dynamic.literal(square = square.key, player = piece.side.key, role = piece.role.key)
        )
        .toJSArray,
      naturalPlies = state.adjudication.fold(0)(_.naturalPlies)
    )

  /** A paid question, called only for an attended piece. Uses the owning geometry. */
  @JSExport def targets(handle: js.Any, square: String): js.Array[String] =
    val game = handle.asInstanceOf[Game]
    val board = Fen.board(game.state.fen).get
    val from = Square.fromKey(square).getOrElse(throw IllegalArgumentException("Invalid square"))
    XiangqiRules.attackTargets(board, from).map(_.key).toJSArray
