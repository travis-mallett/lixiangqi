package lila.xiangqi

import Xiangqi.Uci

/** A branch address consists only of native coordinate move identities, independent of notation. */
final case class UciPath private (ids: Vector[Uci]):
  require(ids.size <= UciPath.maxDepth, s"A tree path cannot exceed ${UciPath.maxDepth} moves")

  lazy val value: String = ids.map(_.value).mkString("/")
  def depth: Int = ids.size
  def isEmpty: Boolean = ids.isEmpty
  def nonEmpty: Boolean = ids.nonEmpty
  def computeIds: Vector[Uci] = ids
  def split: Option[(Uci, UciPath)] = ids.headOption.map(_ -> UciPath(ids.tail))
  def parent: UciPath = UciPath(ids.dropRight(1))
  def lastId: Option[Uci] = ids.lastOption
  def +(id: Uci): UciPath = UciPath(ids :+ id)
  def prepend(id: Uci): UciPath = UciPath(id +: ids)
  def take(length: Int): UciPath = UciPath(ids.take(length))
  def drop(length: Int): UciPath = UciPath(ids.drop(length))
  def startsWith(other: UciPath): Boolean = ids.startsWith(other.ids)
  def isPrefixOf(other: UciPath): Boolean = other.startsWith(this)
  def intersect(other: UciPath): UciPath =
    UciPath(ids.zip(other.ids).takeWhile((a, b) => a == b).map(_._1))
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
          .foldLeft[Either[String, Vector[Uci]]](Right(Vector.empty)): (result, part) =>
            for
              ids <- result
              move <- Uci.from(part)
            yield ids :+ move
          .map(new UciPath(_))

  def apply(value: String): UciPath =
    from(value).fold(error => throw IllegalArgumentException(error), identity)
  def fromId(id: Uci): UciPath = new UciPath(Vector(id))
  def fromIds(ids: IterableOnce[Uci]): UciPath = new UciPath(ids.iterator.toVector)
