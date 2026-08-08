package lila.game

import chess.format.pgn.{ InitialComments, Parser, Pgn, PgnTree, SanStr, Tag, Tags }
import chess.format.{ Fen, pgn as chessPgn }
import chess.{ ByColor, Centis, Color, Outcome, Ply, Tree }
import chess.rating.IntRatingDiff

import lila.core.LightUser
import lila.core.config.RouteUrl
import lila.core.game.PgnDump.WithFlags
import lila.core.game.{ Game, Player }
import lila.game.GameExt.perfType
import lila.game.Player.nameSplit

final class PgnDump(
    routeUrl: RouteUrl,
    lightUserApi: lila.core.user.LightUserApiMinimal,
    fideIdOf: lila.core.user.PublicFideIdOf
)(using Executor)
    extends lila.core.game.PgnDump:

  import PgnDump.*

  def apply(
      game: Game,
      initialFen: Option[Fen.Full],
      flags: WithFlags,
      teams: Option[ByColor[TeamId]] = None
  ): Fu[Pgn] =
    val imported = game.pgnImport.flatMap(pgni => Parser.tags(pgni.pgn).toOption)

    val tagsFuture =
      if flags.tags then
        tags(
          game,
          initialFen,
          imported,
          withOpening = flags.opening,
          withRating = flags.rating,
          teams = teams
        )
      else fuccess(Tags(Nil))

    tagsFuture.map: ts =>
      val tree = flags.moves.so:
        makeTree(
          applyDelay(game.sans, flags.keepDelayIf(game.playable)),
          flags.clocks.so(~game.bothClockStates),
          game.startColor
        )
      Pgn(ts, InitialComments.empty, tree, game.startedAtPly.next)

  private def gameUrl(id: GameId) = routeUrl(routes.Round.watcher(id, Color.White))

  private type GameUsers = ByColor[Option[LightUser]]

  private def gameLightUsers(game: Game): Fu[GameUsers] =
    game.players.traverse(_.userId.so(lightUserApi.async))

  private def rating(p: Player) = p.rating.orElse(p.nameSplit.flatMap(_._2)).fold("?")(_.toString)

  def player(p: Player, u: Option[LightUser]): String | UserName =
    p.aiLevel.fold(
      u.fold(p.nameSplit.map(_._1.value).orElse(p.name.map(_.value)) | UserName.anonymous)(_.name)
    )("lichess AI level " + _)

  private def eventOf(game: Game) =
    val perf = game.perfType.nameKey
    game.tournamentId
      .map(id => s"${game.rated.name} $perf tournament ${routeUrl(routes.Tournament.show(id))}")
      .orElse(game.simulId.map(id => s"$perf simul ${routeUrl(routes.Simul.show(id))}"))
      .getOrElse(s"${game.rated.name} $perf game")

  private def ratingDiffTag(p: Player, tag: String) =
    p.ratingDiff.map(rd => Tag(tag, s"${if !rd.negative then "+" else ""}$rd"))

  def tags(
      game: Game,
      @annotation.unused initialFen: Option[Fen.Full],
      importedTags: Option[Tags],
      @annotation.unused withOpening: Option[Boolean],
      withRating: Boolean,
      teams: Option[ByColor[TeamId]] = None
  ): Fu[Tags] = for
    users <- gameLightUsers(game)
    fideIds <- users.traverse(_.so(fideIdOf))
  yield Tags:
    val importedDate = importedTags.flatMap(_.apply(_.Date))
    List[Option[Tag]](
      Tag(
        _.Event,
        importedTags.flatMap(_.apply(_.Event)) | {
          if game.sourceIs(_.Import) then "Import" else eventOf(game)
        }
      ).some,
      Tag(_.Site, importedTags.flatMap(_.apply(_.Site)) | gameUrl(game.id)).some,
      Tag(_.GameId, game.id).some,
      Tag(_.Date, importedDate | Tag.UTCDate.format.print(game.createdAt)).some,
      Tag(_.Round, importedTags.flatMap(_.apply(_.Round)) | "-").some,
      Tag("Red", player(game.whitePlayer, users.white)).some,
      Tag("Black", player(game.blackPlayer, users.black)).some,
      Tag(_.Result, result(game)).some,
      importedDate.isEmpty.option:
        Tag(_.UTCDate, importedTags.flatMap(_.apply(_.UTCDate)) | Tag.UTCDate.format.print(game.createdAt))
      ,
      importedDate.isEmpty.option:
        Tag(_.UTCTime, importedTags.flatMap(_.apply(_.UTCTime)) | Tag.UTCTime.format.print(game.createdAt))
      ,
      withRating.option(Tag("RedElo", rating(game.whitePlayer))),
      withRating.option(Tag("BlackElo", rating(game.blackPlayer))),
      withRating.so(ratingDiffTag(game.whitePlayer, "RedRatingDiff")),
      withRating.so(ratingDiffTag(game.blackPlayer, "BlackRatingDiff")),
      users.white.flatMap(_.title).map(Tag("RedTitle", _)),
      users.black.flatMap(_.title).map(Tag("BlackTitle", _)),
      fideIds.white.map(Tag("RedFideId", _)),
      fideIds.black.map(Tag("BlackFideId", _)),
      teams.map(t => Tag("RedTeam", t.white)),
      teams.map(t => Tag("BlackTeam", t.black)),
      game.whitePlayer.berserk.option(Tag("RedBerserk", game.whitePlayer.berserk)),
      game.blackPlayer.berserk.option(Tag("BlackBerserk", game.blackPlayer.berserk)),
      Tag(_.Variant, "Xiangqi").some,
      Tag("MoveFormat", "WXF").some,
      game.daysPerTurn
        .map(dpt => Tag(_.TimeControl, s"$dpt day${if dpt.value > 1 then "s" else ""} per move"))
        .orElse(Tag.timeControl(game.clock.map(_.config)).some),
      game.moveTimeLimit.map: limit =>
        Tag(
          "MoveTimeLimit",
          limit.first.fold(s"${limit.seconds}"): first =>
            s"${first.seconds}/${first.moves}:${limit.seconds}"
        ),
      Tag(
        _.Termination, {
          import chess.Status.*
          game.status match
            case Created | Started => "Unterminated"
            case Aborted | NoStart => "Abandoned"
            case Timeout | Outoftime => "Time forfeit"
            case Resign | Draw | Stalemate | Mate | VariantEnd => "Normal"
            case InsufficientMaterialClaim => "Insufficient material"
            case Cheat => "Rules infraction"
            case UnknownFinish => "Unknown"
        }
      ).some
    ).flatten ::: game.fromPosition.so:
      List(Tag(_.FEN, game.xiangqi.initialFen), Tag("SetUp", "1"))

object PgnDump:

  export lila.core.game.PgnDump.*

  private val delayMovesBy = 3
  private val delayKeepsFirstMoves = 5

  private[game] def makeTree(
      moves: Seq[SanStr],
      clocks: Vector[Centis],
      startColor: Color
  ): Option[PgnTree] =
    val clockOffset = startColor.fold(0, 1)
    def f(san: SanStr, index: Int) = chessPgn.Move(
      san = san,
      timeLeft = clocks.lift(index - clockOffset).map(_.roundSeconds)
    )
    Tree.buildWithIndex(moves, f)

  def applyDelay[M](moves: Seq[M], flags: WithFlags): Seq[M] =
    if !flags.delayMoves then moves
    else moves.take((moves.size - delayMovesBy).atLeast(delayKeepsFirstMoves))

  def result(game: Game) =
    Outcome.showResult(game.finished.option(Outcome(game.winnerColor)))
