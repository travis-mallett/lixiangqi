package lila.xiangqi

/** PGN-family TimeControl values use seconds. Move-count stages apply independently to each side. */
final case class XiangqiClockControl(stages: Vector[XiangqiClockControl.Stage]):
  require(stages.nonEmpty)
  def initial: Int = stages.head.limit

  def creditAfterMove(moveNumber: Int): Int =
    require(moveNumber >= 1)
    var offset = 0
    var index = 0
    while index < stages.size - 1 && stages(index).moves.exists(offset + _ < moveNumber) do
      offset += stages(index).moves.get
      index += 1
    val stage = stages(index)
    val nextPeriod = stage.moves.exists(count => (moveNumber - offset) % count == 0)
    stage.increment + (if nextPeriod then stages.lift(index + 1).getOrElse(stage).limit else 0)

object XiangqiClockControl:
  final case class Stage(moves: Option[Int], limit: Int, increment: Int)

  def parse(text: String): Either[String, Option[XiangqiClockControl]] =
    if text == "?" || text == "-" then Right(None)
    else
      def centis(value: String): Either[String, Int] =
        scala.util
          .Try(BigDecimal(value) * 100)
          .toOption
          .filter(n => value.matches("[0-9]+(?:\\.[0-9]+)?") && n.isValidInt && n >= 0)
          .map(_.toInt)
          .toRight(s"Invalid TimeControl seconds: $value")
      def stage(value: String): Either[String, Stage] =
        val parts = value.split("/", -1)
        val moves: Either[String, Option[Int]] = if parts.length == 1 then Right(None)
        else if parts.length == 2 then
          parts(0).toIntOption.filter(_ > 0).map(Some(_)).toRight("Invalid TimeControl move count")
        else Left("Invalid TimeControl stage")
        val clock = parts.last.split("\\+", -1)
        for
          count <- moves
          _ <- Either.cond(clock.length <= 2, (), "Invalid TimeControl increment")
          limit <- centis(clock(0))
          increment <- clock.lift(1).fold[Either[String, Int]](Right(0))(centis)
        yield Stage(count, limit, increment)
      text
        .split(":", -1)
        .toVector
        .foldLeft[Either[String, Vector[Stage]]](Right(Vector.empty)) { (acc, part) =>
          for previous <- acc; next <- stage(part) yield previous :+ next
        }
        .flatMap { stages =>
          Either.cond(
            stages.init.forall(_.moves.isDefined),
            Some(XiangqiClockControl(stages)),
            "A nonfinal TimeControl stage requires a move count"
          )
        }
