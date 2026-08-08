package lila.core
package game

import _root_.chess.format.Fen
import _root_.chess.{ ByColor, Clock, Ply, Rated, Status }
import _root_.chess.variant.{ Standard, Variant }
import scalalib.ThreadLocalRandom
import scalalib.model.Days

import lila.core.id.GameId
import lila.xiangqi.Xiangqi

case class ImportedGame(sloppy: Game, initialFen: Option[Fen.Full] = None):

  def withId(id: GameId): Game = sloppy.copy(id = id)

def newImportedGame(
    xiangqi: Xiangqi.Game,
    players: ByColor[Player],
    rated: Rated,
    source: Source,
    pgnImport: Option[PgnImport],
    daysPerTurn: Option[Days] = None,
    rules: Set[GameRule] = Set.empty,
    clock: Option[Clock] = None,
    moveTimeLimit: Option[MoveTimeLimit] = None,
    moveTimePaused: Boolean = false,
    startedAtPly: Ply = Ply.initial,
    variant: Variant = Standard
): ImportedGame =
  ImportedGame(
    newSloppy(
      xiangqi,
      players,
      rated,
      source,
      pgnImport,
      daysPerTurn,
      rules,
      clock,
      moveTimeLimit,
      moveTimePaused,
      startedAtPly,
      variant
    )
  )

// Wrapper around newly created games. We do not know if the id is unique, yet.
case class NewGame(sloppy: Game):
  def withId(id: GameId): Game = sloppy.copy(id = id)
  def start: NewGame = NewGame(sloppy.start)

def newGame(
    xiangqi: Xiangqi.Game,
    players: ByColor[Player],
    rated: Rated,
    source: Source,
    pgnImport: Option[PgnImport],
    daysPerTurn: Option[Days] = None,
    rules: Set[GameRule] = Set.empty,
    clock: Option[Clock] = None,
    moveTimeLimit: Option[MoveTimeLimit] = None,
    moveTimePaused: Boolean = false,
    startedAtPly: Ply = Ply.initial,
    variant: Variant = Standard
): NewGame =
  NewGame(
    newSloppy(
      xiangqi,
      players,
      rated,
      source,
      pgnImport,
      daysPerTurn,
      rules,
      clock,
      moveTimeLimit,
      moveTimePaused,
      startedAtPly,
      variant
    )
  )

private def newSloppy(
    xiangqi: Xiangqi.Game,
    players: ByColor[Player],
    rated: Rated,
    source: Source,
    pgnImport: Option[PgnImport],
    daysPerTurn: Option[Days] = None,
    rules: Set[GameRule] = Set.empty,
    clock: Option[Clock] = None,
    moveTimeLimit: Option[MoveTimeLimit] = None,
    moveTimePaused: Boolean = false,
    startedAtPly: Ply = Ply.initial,
    variant: Variant = Standard
): Game =
  val createdAt = nowInstant
  new Game(
    id = IdGenerator.uncheckedGame,
    players = players,
    xiangqi = xiangqi,
    clock = clock,
    moveTimeLimit = moveTimeLimit,
    moveTimePaused = moveTimePaused,
    startedAtPly = startedAtPly,
    status = Status.Created,
    daysPerTurn = daysPerTurn,
    rated = rated,
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
