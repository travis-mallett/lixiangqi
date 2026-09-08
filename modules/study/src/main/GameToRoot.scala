package lila.study

import chess.Outcome
import chess.format.Fen
import chess.format.Uci
import chess.format.pgn.SanStr
import chess.format.pgn.Comment as CommentStr

import lila.tree.Node.Comment
import lila.tree.{ Branch, Branches, Root, Clock }

object GameToRoot:

  def apply(game: Game, initialFen: Option[Fen.Full], withClocks: Boolean): Root =
    // The native aggregate already owns the authoritative initial FEN.
    val _ = initialFen
    val states = game.xiangqi.states
    val clocks = withClocks.so(game.bothClockStates).getOrElse(Vector.empty)
    val children = game.xiangqi.moves.zipWithIndex.foldRight(Branches.empty):
      case ((move, index), next) =>
        val state = states(index + 1)
        val encoded = move.value.replace("10", ":")
        Uci(encoded).fold(next): uci =>
          Branches(
            List(
              Branch(
                ply = chess.Ply(state.ply),
                move = Uci.WithSan(uci, SanStr(game.xiangqi.wxf(index))),
                fen = Fen.Full(state.fen),
                children = next,
                clock = clocks.lift(index).map(Clock(_)),
                crazyData = none
              )
            )
          )
    val initial = states.head
    val root = Root(
      ply = chess.Ply(initial.ply),
      fen = Fen.Full(initial.fen),
      children = children,
      clock = withClocks.so(game.clock.map(c => Clock(chess.Centis.ofSeconds(c.limitSeconds.value)))),
      crazyData = none
    )
    endComment(game).fold(root)(comment => root.updateMainlineLast(_.setComment(comment)))

  private def endComment(game: Game) =
    game.finished.option:
      val result = Outcome.showResult(Outcome(game.winnerColor).some)
      val status = lila.tree.StatusText(game.status, game.winnerColor, game.variant)
      val text = s"$result $status"
      Comment(Comment.Id.make, CommentStr(text), Comment.Author.Lichess)
