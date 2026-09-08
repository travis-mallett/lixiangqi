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

  val xiangqiClock = Clock.Config(Clock.LimitSeconds(15 * 60), Clock.IncrementSeconds(0))
  val xiangqiMoveTime =
    MoveTimeLimit(90, MoveTimeLimit.FirstPhase(moves = 3, seconds = 30).some)

  /** The native rank track is a capability granted only to its canonical entry point. Keeping this check
    * beside game construction prevents a legacy caller from becoming ranked by forwarding a flag. A future
    * track adds its own explicit authorization branch here.
    */
  def authorize(
      requested: Option[RankTrackId],
      source: Source,
      variant: Variant,
      clock: Option[Clock.Config],
      moveTimeLimit: Option[MoveTimeLimit],
      players: ByColor[Player]
  ): Option[RankTrackId] =
    requested.filter: track =>
      val snapshots = players.all.flatMap(_.rank)
      track == RankTrackId.xiangqi &&
      source == Source.Pool &&
      variant == Standard &&
      clock.contains(xiangqiClock) &&
      moveTimeLimit.contains(xiangqiMoveTime) &&
      players.all.flatMap(_.userId).distinct.size == 2 &&
      snapshots.size == 2 &&
      snapshots.forall(_.track == track) &&
      snapshots.map(_.catalogVersion).distinct.size == 1 &&
      snapshots.map(_.policyVersion).distinct.size == 1

  def isAuthorized(game: Game): Boolean =
    game.xiangqi.ruleset == lila.xiangqi.adjudication.Ruleset.Tiantian && authorize(
      game.rankTrack,
      game.metadata.source.getOrElse(Source.Lobby),
      game.variant,
      game.clock.map(_.config),
      game.moveTimeLimit,
      game.players
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
    RankedGame.authorize(rankTrack, source, variant, clock.map(_.config), moveTimeLimit, players)
      .filter(_ => xiangqi.ruleset == lila.xiangqi.adjudication.Ruleset.Tiantian)
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
    // A new game is ranked only when a native rank track was assigned by an authorized pool.
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
