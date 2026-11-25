package lila.game

import chess.format.pgn.{ InitialComments, Parser, Pgn, PgnTree, SanStr, Tag, Tags }
import chess.format.{ Fen, pgn as chessPgn }
import chess.{ ByColor, Centis, Color, Outcome, Ply, Tree }

import lila.core.LightUser
import lila.core.config.RouteUrl
import lila.core.game.PgnDump.WithFlags
import lila.core.game.{ Game, Player }
import lila.core.rank.RankTrackId.*
import lila.xiangqi.XiangqiNotation

final class PgnDump(
    routeUrl: RouteUrl,
    lightUserApi: lila.core.user.LightUserApiMinimal,
    playerIdOf: lila.core.user.PublicPlayerIdOf
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
          applyDelay(
            XiangqiNotation.exportMoves(game.xiangqi).map(SanStr(_)),
            flags.keepDelayIf(game.playable)
          ),
          flags.clocks.so(~game.bothClockStates),
          game.startColor
        )
      Pgn(ts, InitialComments.empty, tree, game.startedAtPly.next)

  private def gameUrl(id: GameId) = routeUrl(routes.Round.watcher(id, Color.White))

  private type GameUsers = ByColor[Option[LightUser]]

  private def gameLightUsers(game: Game): Fu[GameUsers] =
    game.players.traverse(_.userId.so(lightUserApi.async))

  private def rank(p: Player) = p.rank.flatMap(_.publicCode).fold("Unranked")(_.value)

  private def eventOf(game: Game) =
    game.tournamentId
      .map(id => s"Xiangqi tournament ${routeUrl(routes.Tournament.show(id))}")
      .orElse(game.simulId.map(id => s"Xiangqi simul ${routeUrl(routes.Simul.show(id))}"))
      .getOrElse(if game.ranked then s"Ranked ${game.nativeVariant.name} game"
      else s"Casual ${game.nativeVariant.name} game")

  def tags(
      game: Game,
      @annotation.unused initialFen: Option[Fen.Full],
      importedTags: Option[Tags],
      @annotation.unused withOpening: Option[Boolean],
      withRating: Boolean,
      teams: Option[ByColor[TeamId]] = None
  ): Fu[Tags] = for
    users <- gameLightUsers(game)
    playerIds <- users.traverse(_.so(playerIdOf))
  yield Tags:
    val banqi = game.xiangqi.isBanqi
    val first = if banqi then "First" else "Red"
    val second = if banqi then "Second" else "Black"
    val firstArmy = Option
      .when(banqi)(game.position.fen.split(" ")(3))
      .collect:
        case "r" => "Red"
        case "b" => "Black"
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
      Tag(first, Namer.recordedPlayerText(game.whitePlayer, users.white, banqi)).some,
      Tag(second, Namer.recordedPlayerText(game.blackPlayer, users.black, banqi)).some,
      Tag(_.Result, result(game)).some,
      importedDate.isEmpty.option:
        Tag(_.UTCDate, importedTags.flatMap(_.apply(_.UTCDate)) | Tag.UTCDate.format.print(game.createdAt))
      ,
      importedDate.isEmpty.option:
        Tag(_.UTCTime, importedTags.flatMap(_.apply(_.UTCTime)) | Tag.UTCTime.format.print(game.createdAt))
      ,
      withRating.option(Tag(first + "Rank", rank(game.whitePlayer))),
      withRating.option(Tag(second + "Rank", rank(game.blackPlayer))),
      withRating.so(game.rankTrack.map(track => Tag("RankTrack", track.value))),
      users.white.flatMap(_.title).map(Tag(first + "Title", _)),
      users.black.flatMap(_.title).map(Tag(second + "Title", _)),
      playerIds.white.map(Tag(first + "PlayerId", _)),
      playerIds.black.map(Tag(second + "PlayerId", _)),
      teams.map(t => Tag(first + "Team", t.white)),
      teams.map(t => Tag(second + "Team", t.black)),
      game.whitePlayer.berserk.option(Tag(first + "Berserk", game.whitePlayer.berserk)),
      game.blackPlayer.berserk.option(Tag(second + "Berserk", game.blackPlayer.berserk)),
      firstArmy.map(Tag("FirstArmy", _)),
      Tag(_.Variant, game.nativeVariant.name).some,
      Tag("MoveFormat", if banqi then "Banqi" else "WXF").some,
      Tag("Ruleset", game.xiangqi.ruleset.key).some,
      game.position.termination.map(Tag("Adjudication", _)),
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
