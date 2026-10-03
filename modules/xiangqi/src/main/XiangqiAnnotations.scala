package lila.xiangqi

import scala.collection.mutable
import play.api.libs.json.*

import Xiangqi.Square

/** Structured notation annotations. Unknown directives remain ordinary comment data. */
object XiangqiAnnotations:
  enum Shape:
    case Circle(brush: String, orig: Square)
    case Arrow(brush: String, orig: Square, dest: Square)

  final case class Evaluation(cp: Option[Int], mate: Option[Int], depth: Option[Int] = None):
    require(cp.isDefined != mate.isDefined, "An evaluation requires exactly one score")
    require(depth.forall(_ > 0), "Evaluation depth must be positive")

  final case class Gamebook(deviation: Option[String], hint: Option[String]):
    def cleanUp: Gamebook =
      copy(deviation = deviation.map(_.trim).filter(_.nonEmpty), hint = hint.map(_.trim).filter(_.nonEmpty))
    def nonEmpty: Boolean = deviation.nonEmpty || hint.nonEmpty
  object Gamebook:
    given OFormat[Gamebook] = Json.format

  /** The explicit notation boundary for study-only teaching and presentation metadata. */
  final case class Study(
      forceVariation: Boolean = false,
      gamebook: Option[Gamebook] = None,
      computer: Boolean = false,
      clockTrust: Option[Boolean] = None
  )
  object Study:
    given OFormat[Study] = Json.using[Json.WithDefaultValues].format[Study]

  /** Comment attribution at the notation boundary, independent of application accounts. */
  final case class Author(kind: String, id: Option[String] = None, name: Option[String] = None):
    require(name.forall(n => n.nonEmpty && n.length <= 150), "Invalid comment author name")
    require(
      kind match
        case "user" => id.exists(_.matches("[a-z0-9_-]{2,30}")) && name.isDefined
        case "external" => id.isEmpty && name.isDefined
        case "site" | "unknown" => id.isEmpty && name.isEmpty
        case _ => false
      ,
      "Invalid comment author"
    )
  object Author:
    given OFormat[Author] = Json.format

  final case class Comment(text: String, id: Option[String] = None, by: Option[Author] = None):
    require(text.nonEmpty && text.length <= 4000, "Comments must contain 1 to 4000 characters")
    require(id.isDefined == by.isDefined, "Comment identity and author must be supplied together")
    require(id.forall(_.matches("[A-Za-z0-9_-]{1,64}")), "Invalid comment identity")
  object Comment:
    given OFormat[Comment] = Json.format

  final case class Parsed(
      comments: Vector[Comment] = Vector.empty,
      shapes: Vector[Shape] = Vector.empty,
      clock: Option[Int] = None,
      elapsed: Option[Int] = None,
      evaluation: Option[Evaluation] = None,
      study: Option[Study] = None
  )

  private val directive = """\[%([A-Za-z]+)\s+((?:"(?:\\.|[^"\\])*"|[^\]"])*)\]""".r
  private val knownStart = "\\[%(?:csl|cal|clk|emt|eval|study|comment)\\b".r
  private val brushes = Map('G' -> "green", 'R' -> "red", 'B' -> "blue", 'Y' -> "yellow")
  private val circle = "^([GRBY])([a-i](?:10|[1-9]))$".r
  private val arrow = "^([GRBY])([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$".r

  def parse(comments: Vector[String]): Either[String, Parsed] =
    var parsed = Parsed()
    var error: Option[String] = None
    val texts = mutable.ArrayBuffer.empty[Comment]
    comments.foreach: comment =>
      val remaining = new StringBuilder
      var offset = 0
      var attributed = false
      directive
        .findAllMatchIn(comment)
        .foreach: found =>
          remaining.append(comment.substring(offset, found.start))
          val kind = found.group(1)
          val value = found.group(2).trim
          val next: Either[String, Parsed] = kind match
            case "comment" =>
              scala.util
                .Try:
                  val obj = Json.parse(value).as[JsObject]
                  require(obj.keys == Set("text", "id", "by"), "Invalid comment annotation fields")
                  val by = (obj \ "by").as[JsObject]
                  require(by.keys.subsetOf(Set("kind", "id", "name")), "Unknown comment author field")
                  val comment = obj.as[Comment]
                  require(comment.id.isDefined && comment.by.isDefined, "Comment attribution is required")
                  texts += comment
                  attributed = true
                  parsed
                .toEither
                .left
                .map(error => s"Invalid comment annotation: ${error.getMessage}")
            case "csl" | "cal" =>
              value
                .split(",", -1)
                .toVector
                .foldLeft[Either[String, Vector[Shape]]](Right(Vector.empty)): (acc, item) =>
                  for
                    shapes <- acc
                    shape <- parseShape(kind, item.trim)
                  yield shapes :+ shape
                .map(shapes => parsed.copy(shapes = parsed.shapes ++ shapes))
            case "clk" =>
              for
                clock <- parseClock(value)
                _ <- compatible(parsed.clock, clock, "clock")
              yield parsed.copy(clock = Some(clock))
            case "emt" =>
              for
                elapsed <- parseClock(value)
                _ <- compatible(parsed.elapsed, elapsed, "elapsed time")
              yield parsed.copy(elapsed = Some(elapsed))
            case "eval" =>
              for
                evaluation <- parseEvaluation(value)
                _ <- compatible(parsed.evaluation, evaluation, "evaluation")
              yield parsed.copy(evaluation = Some(evaluation))
            case "study" =>
              for
                json <- scala.util
                  .Try(Json.parse(value))
                  .toEither
                  .left
                  .map(_ => "Invalid study annotation JSON")
                obj <- json.asOpt[JsObject].toRight("Study annotations must be an object")
                _ <- Either.cond(
                  obj.keys.subsetOf(Set("forceVariation", "gamebook", "computer", "clockTrust")),
                  (),
                  "Unknown study annotation field"
                )
                _ <- Either.cond(
                  (obj \ "gamebook").toOption.forall {
                    case nested: JsObject => nested.keys.subsetOf(Set("hint", "deviation"))
                    case JsNull => true
                    case _ => false
                  },
                  (),
                  "Invalid or unknown gamebook annotation field"
                )
                study <- obj.validate[Study].asEither.left.map(_ => "Invalid study annotation fields")
                _ <- compatible(parsed.study, study, "study")
              yield parsed.copy(study = Some(study))
            case _ =>
              remaining.append(found.matched)
              Right(parsed)
          next match
            case Left(message) => if error.isEmpty then error = Some(message)
            case Right(value) => parsed = value
          offset = found.end
      remaining.append(comment.substring(offset))
      val text = remaining.result().trim
      if knownStart.findFirstIn(text).isDefined && error.isEmpty then
        error = Some("Malformed notation annotation")
      if text.nonEmpty then
        if attributed && error.isEmpty then
          error = Some("Attributed comments must be separate comment records")
        else if text.length > 4000 && error.isEmpty then
          error = Some("Comments must contain at most 4000 characters")
        else if text.length <= 4000 then texts += Comment(text)
    val ids = texts.flatMap(_.id)
    if ids.distinct.size != ids.size && error.isEmpty then error = Some("Duplicate comment identity")
    error.toLeft(parsed.copy(comments = texts.toVector))

  def render(parsed: Parsed): Vector[String] =
    def brush(value: String): Char = brushes
      .find(_._2 == value)
      .map(_._1)
      .getOrElse(throw IllegalArgumentException(s"Unsupported annotation brush: $value"))
    val shapes = parsed.shapes.map:
      case Shape.Circle(color, square) => s"[%csl ${brush(color)}${square.key}]"
      case Shape.Arrow(color, orig, dest) => s"[%cal ${brush(color)}${orig.key}${dest.key}]"
    val directives = (shapes ++ Vector(
      parsed.clock.map(c => s"[%clk ${showClock(c)}]"),
      parsed.elapsed.map(c => s"[%emt ${showClock(c)}]"),
      parsed.study.map(study => s"[%study ${Json.stringify(Json.toJson(study))}]"),
      parsed.evaluation.map: evaluation =>
        val score = evaluation.cp
          .map(cp => BigDecimal(cp, 2).bigDecimal.stripTrailingZeros.toPlainString)
          .getOrElse(s"#${evaluation.mate.get}")
        s"[%eval $score${evaluation.depth.fold("")(d => s",$d")}]"
    ).flatten).mkString(" ")
    parsed.comments.map(comment =>
      if comment.id.isDefined then s"[%comment ${Json.stringify(Json.toJson(comment))}]" else comment.text
    ) ++ Option.when(directives.nonEmpty)(directives)

  private def compatible[A](previous: Option[A], value: A, name: String): Either[String, Unit] =
    Either.cond(previous.forall(_ == value), (), s"Conflicting $name annotations")

  private def parseShape(kind: String, value: String): Either[String, Shape] = (kind, value) match
    case ("csl", circle(color, square)) =>
      Right(Shape.Circle(brushes(color.head), Square.fromKey(square).get))
    case ("cal", arrow(color, orig, dest)) =>
      Right(Shape.Arrow(brushes(color.head), Square.fromKey(orig).get, Square.fromKey(dest).get))
    case _ => Left(s"Invalid Xiangqi $kind annotation: $value")

  private def parseClock(value: String): Either[String, Int] =
    val fields = value.replace(',', '.').split(":", -1)
    def integer(value: String) =
      Option.when(value.nonEmpty && value.forall(_.isDigit))(value.toIntOption).flatten
    def decimal(value: String) =
      Option.when(value.matches("[0-9]+(?:\\.[0-9]+)?"))(scala.util.Try(BigDecimal(value)).toOption).flatten
    val seconds = fields match
      case Array(hours, minutes, seconds) =>
        for
          h <- integer(hours)
          m <- integer(minutes).filter(_ < 60)
          s <- decimal(seconds).filter(_ < 60)
        yield BigDecimal(h) * 3600 + m * 60 + s
      case Array(hours, minutes) =>
        // External two-field notation writes hours:minutes.seconds.
        for
          h <- integer(hours)
          m <- decimal(minutes)
          fullMinutes = m.toInt
          s = (m - fullMinutes) * 100
          if fullMinutes < 60 && s < 60
        yield BigDecimal(h) * 3600 + fullMinutes * 60 + s
      case _ => None
    seconds
      .map(s => (s * 100).setScale(0, BigDecimal.RoundingMode.HALF_UP))
      .filter(_.isValidInt)
      .map(_.toInt)
      .toRight(s"Invalid clock annotation: $value")

  private def showClock(centis: Int): String =
    require(centis >= 0, "A clock annotation cannot be negative")
    val hours = centis / 360000
    val minutes = centis / 6000 % 60
    val seconds = centis / 100 % 60
    val fraction = centis % 100
    f"$hours%d:$minutes%02d:$seconds%02d.$fraction%02d"

  private def parseEvaluation(value: String): Either[String, Evaluation] =
    val fields = value.split(",", -1).map(_.trim)
    val depth = fields.lift(1).map(_.toIntOption.filter(_ > 0))
    if fields.length > 2 || depth.contains(None) then Left(s"Invalid evaluation annotation: $value")
    else
      val score = fields(0)
      if score.startsWith("#") then
        score
          .drop(1)
          .toIntOption
          .map(mate => Evaluation(None, Some(mate), depth.flatten))
          .toRight(s"Invalid evaluation annotation: $value")
      else
        scala.util
          .Try(BigDecimal(score) * 100)
          .toOption
          .filter(_.isValidInt)
          .map(cp => Evaluation(Some(cp.toInt), None, depth.flatten))
          .toRight(s"Invalid evaluation annotation: $value")
