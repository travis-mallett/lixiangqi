package lila.xiangqi

import Xiangqi.Uci

/** A flip is an action with several possible public outcomes. Its revealed face distinguishes siblings. */
final case class BranchId(move: Uci, reveal: Option[Char] = None):
  require(reveal.forall(c => move.orig == move.dest && "KABRNCPkabrncp".contains(c)))
  def value: String = reveal.fold(move.value)(face => s"${move.value}~$face")

object BranchId:
  def from(value: String): Either[String, BranchId] = value.split("~", -1).toList match
    case action :: Nil => Uci.from(action).map(BranchId(_))
    case action :: face :: Nil if face.length == 1 && "KABRNCPkabrncp".contains(face.head) =>
      Uci
        .from(action)
        .filterOrElse(
          m => m.orig == m.dest && m.orig.length == 2 && m.orig.head <= 'd' && m.orig.last <= '8',
          "Invalid Banqi flip"
        )
        .map(BranchId(_, Some(face.head)))
    case _ => Left("Invalid branch identity")

/** Each step identifies the recorded outcome, independently of display notation. */
final case class UciPath private (steps: Vector[BranchId]):
  require(steps.size <= UciPath.maxDepth, s"A tree path cannot exceed ${UciPath.maxDepth} moves")

  lazy val value: String = steps.map(_.value).mkString("/")
  def depth: Int = steps.size
  def isEmpty: Boolean = steps.isEmpty
  def nonEmpty: Boolean = steps.nonEmpty
  def computeIds: Vector[Uci] = steps.map(_.move)
  def split: Option[(BranchId, UciPath)] = steps.headOption.map(_ -> UciPath(steps.tail))
  def parent: UciPath = UciPath(steps.dropRight(1))
  def lastId: Option[BranchId] = steps.lastOption
  def +(id: BranchId): UciPath = UciPath(steps :+ id)
  def +(move: Uci): UciPath = this + BranchId(move)
  def prepend(id: BranchId): UciPath = UciPath(id +: steps)
  def prepend(move: Uci): UciPath = prepend(BranchId(move))
  def take(length: Int): UciPath = UciPath(steps.take(length))
  def drop(length: Int): UciPath = UciPath(steps.drop(length))
  def startsWith(other: UciPath): Boolean = steps.startsWith(other.steps)
  def isPrefixOf(other: UciPath): Boolean = other.startsWith(this)
  def intersect(other: UciPath): UciPath =
    UciPath(steps.zip(other.steps).takeWhile((a, b) => a == b).map(_._1))
  override def toString: String = value

object UciPath:
  val maxDepth = 600
  val root: UciPath = new UciPath(Vector.empty)

  def from(value: String): Either[String, UciPath] =
    if value.isEmpty then Right(root)
    else if value.length > maxDepth * 7 - 1 then Left("Tree path is too long")
    else
      val parts = value.split("/", -1).toVector
      if parts.size > maxDepth then Left(s"A tree path cannot exceed $maxDepth moves")
      else
        parts
          .foldLeft[Either[String, Vector[BranchId]]](Right(Vector.empty)): (result, part) =>
            for
              ids <- result
              move <- BranchId.from(part)
            yield ids :+ move
          .map(new UciPath(_))

  def apply(value: String): UciPath =
    from(value).fold(error => throw IllegalArgumentException(error), identity)
  def fromId(id: BranchId): UciPath = new UciPath(Vector(id))
  def fromId(move: Uci): UciPath = fromId(BranchId(move))
  def fromIds(ids: IterableOnce[BranchId]): UciPath = new UciPath(ids.iterator.toVector)
