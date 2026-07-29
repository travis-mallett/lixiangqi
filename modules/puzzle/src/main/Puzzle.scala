package lila.puzzle

import chess.{ Ply, IntRating }
import chess.rating.glicko.Glicko

import lila.xiangqi.{ Xiangqi, XiangqiRules }

case class Puzzle(
    id: PuzzleId,
    gameId: GameId,
    gameSource: Option[Puzzle.GameSource],
    fen: String,
    line: NonEmptyList[Xiangqi.Uci],
    glicko: Glicko,
    plays: Int,
    vote: Float, // denormalized ratio of voteUp/voteDown
    themes: Set[PuzzleTheme.Key]
):
  def gameRef: Puzzle.GameRef =
    gameSource.fold[Puzzle.GameRef](Puzzle.GameRef.Lila(gameId)):
      case Puzzle.GameSource.Catalog(database) =>
        Puzzle.GameRef.Catalog(database = database, id = gameId.value)

  // ply after "initial move" when we start solving
  def initialPly: Ply =
    Ply(XiangqiRules.position(Xiangqi.Position(initialFen = fen)).fold(_ => 0, _.ply))

  lazy val stateAfterInitialMove: Option[Xiangqi.State] =
    XiangqiRules.move(Xiangqi.Position(initialFen = fen), line.head).toOption.map(_.state)

  lazy val initialGame: Xiangqi.Game =
    XiangqiRules
      .game(Xiangqi.Position(initialFen = fen, moves = Vector(line.head)))
      .fold(error => sys.error(s"Can't initialize puzzle $id: $error"), identity)

  lazy val fenAfterInitialMove: String =
    stateAfterInitialMove.map(_.fen).err(s"Can't apply puzzle $id first move")

  def color =
    stateAfterInitialMove
      .fold(chess.Color.White)(state =>
        if state.turn == Xiangqi.Side.Red then chess.Color.White else chess.Color.Black
      )

  def hasTheme(anyOf: PuzzleTheme*) = anyOf.exists(t => themes(t.key))

object Puzzle:

  enum GameSource:
    case Catalog(database: String)

  enum GameRef:
    case Lila(id: GameId)
    case Catalog(database: String, id: String)

  val idSize = 5

  def toId(id: String) = (id.size == idSize).option(PuzzleId(id))

  /* The mobile app requires numerical IDs.
   * We convert string ids from and to Longs using base 62
   */
  object numericalId:

    private val powers: List[Long] =
      (0 until idSize).toList.map(m => Math.pow(62, m).toLong)

    def apply(id: PuzzleId): Long = id.value.toList
      .zip(powers)
      .foldLeft(0L) { case (l, (char, pow)) =>
        l + charToInt(char) * pow
      }

    def apply(l: Long): Option[PuzzleId] = (l > 130_000).so:
      val str = powers.reverse
        .foldLeft(("", l)) { case ((id, rest), pow) =>
          val frac = rest / pow
          (s"${intToChar(frac.toInt)}$id", rest - frac * pow)
        }
        ._1
      (str.size == idSize).option(PuzzleId(str))

    private def charToInt(c: Char) =
      val i = c.toInt
      if i > 96 then i - 71
      else if i > 64 then i - 65
      else i + 4

    private def intToChar(i: Int): Char = {
      if i < 26 then i + 65
      else if i < 52 then i + 71
      else i - 4
    }.toChar

  case class UserResult(
      puzzleId: PuzzleId,
      userId: UserId,
      win: PuzzleWin,
      rating: (IntRating, IntRating)
  )

  object BSONFields:
    val id = "_id"
    val gameId = "gameId"
    val gameSource = "gameSource"
    val fen = "fen"
    val line = "line"
    val glicko = "glicko"
    val vote = "vote"
    val voteUp = "vu"
    val voteDown = "vd"
    val plays = "plays"
    val themes = "themes"
    val day = "day"
    val issue = "issue"
    val dirty = "dirty" // themes need to be denormalized
    val tagMe = "tagMe" // pending phase & opening
