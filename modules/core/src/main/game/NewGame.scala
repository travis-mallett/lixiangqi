package lila.core
package game

import _root_.chess.format.Fen
import _root_.chess.{ ByColor, Clock, Ply, Rated, Status }
import _root_.chess.variant.{ Standard, Variant }
import scalalib.ThreadLocalRandom
import scalalib.model.Days

import lila.core.id.GameId
import lila.core.rank.RankTrackId
import lila.xiangqi.Xiangqi

object RankedGame:

  val jieqiClock = Clock.Config(Clock.LimitSeconds(10 * 60), Clock.IncrementSeconds(0))
  val jieqiMoveTime = MoveTimeLimit(60, MoveTimeLimit.FirstPhase(moves = 3, seconds = 30).some)

  val xiangqiClock = Clock.Config(Clock.LimitSeconds(15 * 60), Clock.IncrementSeconds(0))
  val xiangqiMoveTime =
    MoveTimeLimit(90, MoveTimeLimit.FirstPhase(moves = 3, seconds = 30).some)

  def matchesClock(track: RankTrackId, clock: Option[Clock.Config], limit: Option[MoveTimeLimit]): Boolean =
    RankTrackId.variant(track).playerCount == 2 &&
      clock.contains(if track == RankTrackId.xiangqi then xiangqiClock else jieqiClock) &&
      limit.contains(if track == RankTrackId.xiangqi then xiangqiMoveTime else jieqiMoveTime)

  /** The native rank track is a capability granted only to its canonical entry point. Keeping this check
    * beside game construction prevents a legacy caller from becoming ranked by forwarding a flag. A future
    * track adds its own explicit authorization branch here.
    */
  def correspondenceSource(source: Source): Boolean =
    source == Source.Lobby || source == Source.Friend || source == Source.Api

  def authorize(
      requested: Option[RankTrackId],
      source: Source,
      variant: Variant,
      clock: Option[Clock.Config],
      moveTimeLimit: Option[MoveTimeLimit],
      players: ByColor[Player],
      days: Option[Days] = None
  ): Option[RankTrackId] =
    requested.filter: track =>
      val snapshots = players.all.flatMap(_.rank)
      val timing = if RankTrackId.isCorrespondence(track) then
        correspondenceSource(source) && days.exists(_.value > 0) &&
        clock.isEmpty && moveTimeLimit.isEmpty
      else
        (source == Source.Pool || source == Source.Friend) && days.isEmpty && matchesClock(
          track,
          clock,
          moveTimeLimit
        )
      RankTrackId.accounts.contains(track) && RankTrackId.variant(track).playerCount == 2 && timing &&
      variant == Standard &&
      players.all.flatMap(_.userId).distinct.size == 2 &&
      snapshots.size == 2 &&
      (RankTrackId.isCorrespondence(
        track
      ) || (snapshots.head.matchingGroup - snapshots.last.matchingGroup).abs <= 1) &&
      snapshots.forall(_.track == track) &&
      snapshots.map(_.catalogVersion).distinct.size == 1 &&
      snapshots.map(_.policyVersion).distinct.size == 1

  def hasRankedStart(position: Xiangqi.Game, correspondence: Boolean): Boolean =
    position.initialFen == position.variant.startFen && (position.ruleset == position.variant.defaultRuleset ||
      (correspondence && position.variant.selectableRulesets.contains(position.ruleset)))

  def isAuthorized(game: Game): Boolean =
    hasRankedStart(
      game.xiangqi,
      game.daysPerTurn.isDefined
    ) && game.metadata.rules.isEmpty && game.metadata.pgnImport.isEmpty &&
      game.rankTrack.exists(t => RankTrackId.live(t) == RankTrackId.of(game.nativeVariant)) && authorize(
        game.rankTrack,
        game.metadata.source.getOrElse(Source.Lobby),
        game.variant,
        game.clock.map(_.config),
        game.moveTimeLimit,
        game.players,
        game.daysPerTurn
      ).isDefined

  def asCasual(game: Game): Game =
    game.copy(
      rated = Rated.No,
      rankTrack = None
    )

case class ImportedGame(sloppy: Game, initialFen: Option[Fen.Full] = None):

  def withId(id: GameId): Game = sloppy.copy(id = id)

def newImportedGame(
    xiangqi: Xiangqi.Game,
    players: ByColor[Player],
    @annotation.unused rated: Rated,
    source: Source,
    pgnImport: Option[PgnImport],
    daysPerTurn: Option[Days] = None,
    rules: Set[GameRule] = Set.empty,
    clock: Option[Clock] = None,
    moveTimeLimit: Option[MoveTimeLimit] = None,
    moveTimePaused: Boolean = false,
    startedAtPly: Ply = Ply.initial,
    variant: Variant = Standard,
    rankTrack: Option[RankTrackId] = None
): ImportedGame =
  ImportedGame(
    newSloppy(
      xiangqi,
      players,
      source,
      pgnImport,
      daysPerTurn,
      rules,
      clock,
      moveTimeLimit,
      moveTimePaused,
      startedAtPly,
      variant,
      rankTrack
    )
  )

// Wrapper around newly created games. We do not know if the id is unique, yet.
case class NewGame(sloppy: Game):
  def withId(id: GameId): Game = sloppy.copy(id = id)
  def start: NewGame = NewGame(sloppy.start)

def newGame(
    xiangqi: Xiangqi.Game,
    players: ByColor[Player],
    @annotation.unused rated: Rated,
    source: Source,
    pgnImport: Option[PgnImport],
    daysPerTurn: Option[Days] = None,
    rules: Set[GameRule] = Set.empty,
    clock: Option[Clock] = None,
    moveTimeLimit: Option[MoveTimeLimit] = None,
    moveTimePaused: Boolean = false,
    startedAtPly: Ply = Ply.initial,
    variant: Variant = Standard,
    rankTrack: Option[RankTrackId] = None
): NewGame =
  require(
    xiangqi.variant.playerCount == 2 && xiangqi.variant.supportsRuleset(xiangqi.ruleset),
    s"Invalid rules for ${xiangqi.variant.name}"
  )
  NewGame(
    newSloppy(
      xiangqi,
      players,
      source,
      pgnImport,
      daysPerTurn,
      rules,
      clock,
      moveTimeLimit,
      moveTimePaused,
      startedAtPly,
      variant,
      rankTrack
    )
  )

private def newSloppy(
    xiangqi: Xiangqi.Game,
    players: ByColor[Player],
    source: Source,
    pgnImport: Option[PgnImport],
    daysPerTurn: Option[Days] = None,
    rules: Set[GameRule] = Set.empty,
    clock: Option[Clock] = None,
    moveTimeLimit: Option[MoveTimeLimit] = None,
    moveTimePaused: Boolean = false,
    startedAtPly: Ply = Ply.initial,
    variant: Variant = Standard,
    rankTrack: Option[RankTrackId] = None
): Game =
  val createdAt = nowInstant
  val authorizedRankTrack =
    RankedGame
      .authorize(rankTrack, source, variant, clock.map(_.config), moveTimeLimit, players, daysPerTurn)
      .filter: track =>
        RankTrackId.live(track) == RankTrackId
          .of(xiangqi.variant) && RankedGame.hasRankedStart(xiangqi, daysPerTurn.isDefined) &&
          rules.isEmpty && pgnImport.isEmpty
  new Game(
    id = IdGenerator.uncheckedGame,
    // Rank snapshots are also presentation metadata, so casual games retain them. Whether a game
    // may mutate a rank is represented exclusively by the authorized rank track below.
    players = players,
    xiangqi = xiangqi,
    clock = clock,
    moveTimeLimit = moveTimeLimit,
    moveTimePaused = moveTimePaused,
    startedAtPly = startedAtPly,
    status = Status.Created,
    daysPerTurn = daysPerTurn,
    // A new game is ranked only when a native rank track was authorized for its pool or friend challenge.
    // Legacy callers may still pass Rated.Yes, but they cannot create a ranked game implicitly.
    rated = Rated(authorizedRankTrack.isDefined),
    rankTrack = authorizedRankTrack,
    metadata = newMetadata(source).copy(pgnImport = pgnImport, rules = rules),
    variant = variant,
    createdAt = createdAt,
    movedAt = createdAt
  )

trait IdGenerator:
  def game: Fu[GameId]
  def games(nb: Int): Fu[List[GameId]]
  def withUniqueId(sloppy: NewGame): Fu[Game]
object IdGenerator:
  def uncheckedGame: GameId = GameId(ThreadLocalRandom.nextString(GameId.size))
