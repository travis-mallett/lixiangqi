package lila.puzzle

import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import play.api.libs.json.*
import reactivemongo.api.bson.*

/** Wire format and authored-field boundary. Never accepts a production puzzle document. */
object PuzzlePublicationJson:
  val fields = Set(
    "_id",
    "gameId",
    "gameSource",
    "fen",
    "line",
    "themes",
    "retired",
    "retirementReason",
    "sourceSnapshot",
    "playback"
  )
  val identityFields = Set("_id", "gameId", "gameSource", "fen", "line")
  case class Invalid(message: String) extends RuntimeException(message)
  def check(ok: Boolean, message: String): Unit = if !ok then throw Invalid(message)
  def canonical(value: JsValue): String = value match
    case o: JsObject =>
      o.fields
        .sortBy(_._1)
        .map((k, v) => s"${Json.stringify(JsString(k))}:${canonical(v)}")
        .mkString("{", ",", "}")
    case JsArray(values) => values.map(canonical).mkString("[", ",", "]")
    case JsNumber(v) => v.bigDecimal.stripTrailingZeros.toPlainString
    case v => Json.stringify(v)
  def digest(value: JsValue): String = MessageDigest
    .getInstance("SHA-256")
    .digest(canonical(value).getBytes(UTF_8))
    .map(b => f"${b & 255}%02x")
    .mkString
  def obj(v: JsValue, keys: Set[String]): JsObject =
    val o = v.asOpt[JsObject].getOrElse(throw Invalid("Expected an object"))
    check(o.keys.subsetOf(keys), "Unowned or unknown fields")
    o
  def str(o: JsValue, key: String): String =
    (o \ key).asOpt[String].getOrElse(throw Invalid(s"Missing string: $key"))
  def normalized(p: JsObject): JsObject =
    p ++ Json.obj("retirementReason" -> (p \ "retirementReason").asOpt[String])
  def identity(p: JsObject): JsObject = JsObject(p.fields.filter((k, _) => identityFields(k)))
  private val uci = "[a-i](?:10|[1-9])[a-i](?:10|[1-9])"
  private def fenPly(fen: String): Int =
    val f = fen.split(" ")
    check(f.length == 6 && Set("w", "b")(f(1)) && f(2) == "-" && f(3) == "-", "Invalid FEN")
    check(f(4).matches("[0-9]{1,6}") && f(5).matches("[1-9][0-9]{0,5}"), "Invalid FEN counters")
    val ranks = f(0).split('/')
    check(
      ranks.length == 10 && ranks.forall(r =>
        r.matches("[1-9kabnrcpKABNRCP]+") && !r
          .matches(".*[0-9][0-9].*") && r.map(c => if c.isDigit then c.asDigit else 1).sum == 9
      ),
      "Invalid board"
    )
    (f(5).toInt - 1) * 2 + (if f(1) == "b" then 1 else 0)
  def puzzle(value: JsValue): JsObject =
    val p = obj(value, fields)
    check((fields - "retirementReason").subsetOf(p.keys), "Incomplete authored content")
    check(str(p, "_id").matches("[A-Za-z0-9]{5}"), "Invalid puzzle ID")
    check(str(p, "gameId").nonEmpty, "Missing source identity")
    val source = obj((p \ "gameSource").get, Set("type", "database", "origin"))
    check(
      (str(source, "type") == "catalog" && source.keys == Set("type", "database") && str(
        source,
        "database"
      ).nonEmpty) ||
        (str(source, "type") == "native" && source.keys == Set("type", "origin") && str(source, "origin")
          .startsWith("https://")),
      "Invalid source identity"
    )
    val ply = fenPly(str(p, "fen"))
    val line = str(p, "line").split(' ')
    check(line.length >= 2 && line.length <= 256 && line.forall(_.matches(uci)), "Invalid solution")
    val playback = obj((p \ "playback").get, Set("objective", "solutions", "startingCp"))
    val objective = str(playback, "objective")
    check(Set("mate", "tactic")(objective), "Invalid puzzle objective")
    val solutions = (playback \ "solutions").as[Vector[Vector[String]]]
    check(
      solutions.headOption.contains(line.tail.toVector) && solutions.forall(s =>
        s.nonEmpty && s.size <= 255 && s.forall(_.matches(uci))
      ),
      "Invalid playback solutions"
    )
    check(
      objective != "tactic" || (playback \ "startingCp").asOpt[Int].exists(_ > 0),
      "Missing starting advantage"
    )
    val themes = (p \ "themes").as[Vector[String]]
    check(
      themes.size <= 64 && themes.distinct == themes && themes.forall(t =>
        PuzzleTheme.findAny(t).isDefined && !Set("opening", "middlegame")(t)
      ),
      "Invalid machine themes"
    )
    val retired = (p \ "retired").as[Boolean]
    check(
      if retired then (p \ "retirementReason").asOpt[String].exists(_.trim.nonEmpty)
      else (p \ "retirementReason").asOpt[String].isEmpty,
      "Invalid retirement reason"
    )
    val s = obj(
      (p \ "sourceSnapshot").get,
      Set("initialFen", "moves", "players", "name", "event", "sourceUrl", "rated", "perf")
    )
    val setup = ply - fenPly(str(s, "initialFen"))
    val moves = (s \ "moves").as[Vector[String]]
    check(
      moves.size <= 4096 && moves.forall(_.matches(uci)) && moves.lift(setup).contains(line.head),
      "Source does not contain setup move"
    )
    val players = (s \ "players").as[Vector[JsObject]]
    check(
      players.size <= 2 && players.map(str(_, "color")).distinct.size == players.size,
      "Invalid source players"
    )
    players.foreach: player =>
      obj(player, Set("color", "userId", "name", "rating"))
      check(Set("red", "black")(str(player, "color")), "Invalid player color")
      Set("userId", "name").foreach(k =>
        check(!player.keys(k) || str(player, k).nonEmpty, "Invalid player identity")
      )
      check(!player.keys("rating") || (player \ "rating").asOpt[Int].exists(_ >= 0), "Invalid player rating")
      check(
        str(source, "type") != "native" || !player.keys("name"),
        "Native player names must resolve from users"
      )
    Set("name", "event", "sourceUrl", "perf").foreach(k =>
      check(!s.keys(k) || (s \ k).asOpt[String].isDefined, "Invalid metadata")
    )
    check(!s.keys("rated") || (s \ "rated").asOpt[Boolean].isDefined, "Invalid rated flag")
    normalized(p)

  def bson(value: JsValue): BSONValue = value match
    case o: JsObject => BSONDocument(o.fields.map((k, v) => k -> bson(v)))
    case JsArray(v) => BSONArray(v.map(bson))
    case JsString(v) => BSONString(v)
    case JsBoolean(v) => BSONBoolean(v)
    case JsNumber(v) if v.isValidInt => BSONInteger(v.toInt)
    case JsNumber(v) => BSONDouble(v.toDouble)
    case _ => BSONNull
  def document(value: JsObject): BSONDocument = bson(value).asInstanceOf[BSONDocument]
  def json(value: BSONValue): JsValue = value match
    case d: BSONDocument => JsObject(d.elements.map(e => e.name -> json(e.value)).toSeq)
    case a: BSONArray => JsArray(a.values.map(json).toSeq)
    case BSONString(v) => JsString(v)
    case BSONBoolean(v) => JsBoolean(v)
    case BSONInteger(v) => JsNumber(v)
    case BSONLong(v) => JsNumber(v)
    case BSONDouble(v) => JsNumber(v)
    case _ => JsNull
  def authored(d: BSONDocument): JsObject =
    val p = json(d).as[JsObject]
    normalized(
      JsObject(p.fields.filter((k, _) => fields(k))) ++ Json.obj(
        "themes" -> (p \ "managedThemes").toOption.getOrElse((p \ "themes").get)
      )
    )
