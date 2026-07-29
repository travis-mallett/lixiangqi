package lila.game
package importer

import chess.{ ByColor, Color, IntRating, PlayerName, Rated, Status }
import chess.format.pgn.PgnStr
import play.api.data.*
import play.api.data.Forms.*

import lila.common.Form.into
import lila.core.game.{ Game, ImportedGame }
import lila.game.GameExt.finish
import lila.xiangqi.{ Xiangqi, XiangqiRules }

final class Importer(gameRepo: lila.core.game.GameRepo)(using Executor):

  def importAsGame(pgn: PgnStr, forceId: Option[GameId] = none)(using me: Option[MyId]): Fu[Game] =
    import lila.db.dsl.{ *, given }
    import lila.core.game.BSONFields as F
    import gameRepo.gameHandler
    gameRepo.coll
      .one[Game]($doc(s"${F.pgnImport}.h" -> lila.game.PgnImport.hash(pgn)))
      .flatMap:
        case Some(game) => fuccess(game)
        case None =>
          for
            tree <-
              XiangqiRules.Notation
                .importTree(Xiangqi.NotationImport(notation = pgn.value))
                .fold(fufail, fuccess)
            g = importedGame(tree, pgn, me)
            game = forceId.fold(g.sloppy)(g.withId)
            _ <- gameRepo.insertDenormalized(game, initialFen = g.initialFen)
            _ <- game.pgnImport
              .flatMap(_.user)
              .isDefined
              .so:
                // import date, used to make a compound sparse index with the user
                gameRepo.coll.updateField($id(game.id), s"${F.pgnImport}.ca", game.createdAt).void
            _ <- gameRepo.finish(game.id, game.winnerColor, None, game.status)
          yield game

  private def importedGame(
      tree: Xiangqi.ImportedMoveTree,
      notation: PgnStr,
      user: Option[UserId]
  ): ImportedGame =
    val game = tree.mainline
    def player(color: Color) =
      val prefix = if color == Color.White then "red" else "black"
      lila.game.Player.makeImported(
        color,
        PlayerName.from(tree.headers.get(prefix).filter(_.nonEmpty)),
        IntRating.from(tree.headers.get(s"${prefix}elo").flatMap(_.toIntOption))
      )
    val imported = lila.core.game
      .newImportedGame(
        xiangqi = game,
        players = ByColor(player),
        rated = Rated.No,
        source = lila.core.game.Source.Import,
        pgnImport = PgnImport.make(user = user, date = None, pgn = notation).some,
        startedAtPly = chess.Ply(tree.state.ply)
      )
      .sloppy
      .start
    val finished = game.state.gameResult match
      case Xiangqi.Result.Ongoing => imported
      case Xiangqi.Result.Draw => imported.finish(Status.Draw, None)
      case Xiangqi.Result.RedWin => imported.finish(Status.Mate, Some(Color.White))
      case Xiangqi.Result.BlackWin => imported.finish(Status.Mate, Some(Color.Black))
    val initialFen: chess.format.Fen.Full = chess.format.Fen.Full(tree.initialFen)
    ImportedGame(finished, Some(initialFen))

case class ImportData(pgn: PgnStr, analyse: Option[String])

val form = Form:
  mapping(
    "pgn" -> nonEmptyText.into[PgnStr],
    "analyse" -> optional(nonEmptyText)
  )(ImportData.apply)(unapply)
