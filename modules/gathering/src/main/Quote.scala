package lila.quote

import play.api.libs.json.*

import scala.util.Random

final class Quote(val text: String, val author: String)

object Quote:

  def one(seed: String) = all(Random(seed.hashCode).nextInt(all.size))

  val all = Vector(
    Quote("Every move changes the whole board.", "Lixiangqi"),
    Quote("Keep the general safe, but do not surrender the initiative.", "Lixiangqi"),
    Quote("A cannon needs a screen; a plan needs a purpose.", "Lixiangqi"),
    Quote("Coordinate moves are the record; WXF is the language.", "Lixiangqi"),
    Quote("All features for free; for everyone; forever.", "Lixiangqi"),
    Quote("We will never display ads.", "Lixiangqi"),
    Quote("We do not track you.", "Lixiangqi"),
    Quote("Every Xiangqi player is a premium user.", "Lixiangqi")
  )

  given OWrites[Quote] = OWrites: q =>
    Json.obj(
      "text" -> q.text,
      "author" -> q.author
    )
