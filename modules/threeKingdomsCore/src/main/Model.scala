package lila.threeKingdoms

/** Army identity is permanent. A surviving player can control several armies. */
enum Kingdom(val key: String, val color: String, val glyph: String):
  case Wei extends Kingdom("wei", "black", "魏")
  case Wu extends Kingdom("wu", "green", "吳")
  case Shu extends Kingdom("shu", "red", "蜀")

object Kingdom:
  val cycle: Vector[Kingdom] = Vector(Kingdom.Shu, Kingdom.Wu, Kingdom.Wei)
  def fromKey(value: String): Option[Kingdom] = values.find(k => k.key == value || k.color == value)
  def at(index: Int): Kingdom = values(Math.floorMod(index, 3))

enum Role(val code: Char, val key: String, val material: Int):
  case General extends Role('k', "general", 20000)
  case Advisor extends Role('a', "advisor", 200)
  case Elephant extends Role('b', "elephant", 200)
  case Horse extends Role('n', "horse", 400)
  case Chariot extends Role('r', "chariot", 900)
  case Cannon extends Role('c', "cannon", 450)
  case Soldier extends Role('p', "soldier", 100)

object Role:
  def fromCode(code: Char): Option[Role] = values.find(_.code == code)

final case class Location(territory: Kingdom, file: Int, rank: Int):
  require(file >= 0 && file < 9 && rank >= 0 && rank < 5)
  def index: Int = territory.ordinal * 45 + rank * 9 + file
  def key: String = s"${territory.key}:$file:$rank"
  def palace: Boolean = file >= 3 && file <= 5 && rank <= 2
  def rotate: Location = copy(territory = Kingdom.at(territory.ordinal + 1))

object Location:
  val all: Vector[Location] = (0 until 135).map(at).toVector
  def at(index: Int): Location = Location(Kingdom.values(index / 45), index % 9, index % 45 / 9)
  def fromKey(value: String): Option[Location] = value.split(':').toList match
    case territory :: file :: rank :: Nil =>
      for
        k <- Kingdom.fromKey(territory)
        f <- file.toIntOption.filter(n => n >= 0 && n < 9)
        r <- rank.toIntOption.filter(n => n >= 0 && n < 5)
      yield Location(k, f, r)
    case _ => None

final case class Piece(army: Kingdom, role: Role)

final case class Move(from: Location, to: Location):
  def key: String = s"${from.key}>${to.key}"

object Move:
  def parse(value: String): Option[Move] = value.split('>').toList match
    case from :: to :: Nil =>
      for
        a <- Location.fromKey(from)
        b <- Location.fromKey(to)
        if a != b
      yield Move(a, b)
    case _ => None

enum LossReason:
  case Capture, Resignation, Timeout, Checkmate, Stalemate, PerpetualCheck

final case class Elimination(player: Kingdom, reason: LossReason, ply: Int)

enum EndReason:
  case LastSurvivor, Agreement, Repetition, NoProgress

final case class Ending(reason: EndReason, winners: Set[Kingdom], draw: Boolean)

final case class Position(
    board: Vector[Option[Piece]],
    turn: Kingdom,
    controllers: Vector[Option[Kingdom]],
    active: Set[Kingdom],
    eliminated: Vector[Elimination] = Vector.empty,
    ply: Int = 0,
    quietPlies: Int = 0,
    lastMove: Option[Move] = None,
    ending: Option[Ending] = None,
    repetitions: Vector[String] = Vector.empty,
    stalemateCredit: Vector[Option[Kingdom]] = Vector.fill(3)(None),
    checkHistory: Vector[(Kingdom, Set[Kingdom])] = Vector.empty
):
  def piece(at: Location): Option[Piece] = board(at.index)
  def controller(piece: Piece): Option[Kingdom] = controllers(piece.army.ordinal)
  def controls(player: Kingdom, piece: Piece): Boolean = controller(piece).contains(player)
  def fallen(piece: Piece): Boolean = piece.role == Role.General && !active.contains(piece.army)
  def general(player: Kingdom): Option[Location] =
    board.indexWhere(_.contains(Piece(player, Role.General))) match
      case -1 => None
      case n => Some(Location.at(n))
  def nextPlayer: Option[Kingdom] =
    val offset = Kingdom.cycle.indexOf(turn)
    (1 to 3).iterator.map(n => Kingdom.cycle((offset + n) % 3)).find(active.contains)
  def finished: Boolean = ending.isDefined
  def placement(player: Kingdom): Option[Double] =
    eliminated.indexWhere(_.player == player) match
      case n if n >= 0 => Some(3d - n)
      case _ => ending.map(e => if e.draw then (active.size + 1d) / 2 else 1d)

object Position:
  val initial: Position =
    import Role.*
    val back = Vector(Chariot, Horse, Elephant, Advisor, General, Advisor, Elephant, Horse, Chariot)
    val pieces = Kingdom.values.toVector.flatMap: army =>
      back.zipWithIndex.map((role, file) => Location(army, file, 0) -> Piece(army, role)) ++
        Vector(1, 7).map(file => Location(army, file, 2) -> Piece(army, Cannon)) ++
        Vector(0, 2, 4, 6, 8).map(file => Location(army, file, 3) -> Piece(army, Soldier))
    val byIndex = pieces.map((location, piece) => location.index -> piece).toMap
    val position = Position(
      Vector.tabulate(135)(byIndex.get),
      Kingdom.Shu,
      Kingdom.values.toVector.map(Some(_)),
      Kingdom.values.toSet
    )
    position.copy(repetitions = Vector(PositionCodec.repetitionKey(position)))

final case class Transition(
    position: Position,
    move: Option[Move],
    actor: Kingdom,
    captured: Option[Piece] = None,
    appropriated: Set[Kingdom] = Set.empty,
    eliminated: Vector[Elimination] = Vector.empty,
    checked: Set[Kingdom] = Set.empty
)
