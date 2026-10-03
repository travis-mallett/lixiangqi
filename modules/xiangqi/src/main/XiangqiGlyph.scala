package lila.xiangqi

import play.api.libs.json.*

/** Numeric annotation identity is independent of the displayed symbol and translation. */
object XiangqiGlyph:
  case class Glyph private (id: Int, symbol: String, name: String):
    def withName(value: String): Glyph = copy(name = value)
    require(id >= 0 && id <= 255, s"Invalid annotation glyph: $id")

  object Glyph:
    object MoveAssessment:
      val good = Glyph(1, "!", "Good move")
      val mistake = Glyph(2, "?", "Mistake")
      val brilliant = Glyph(3, "!!", "Brilliant move")
      val blunder = Glyph(4, "??", "Blunder")
      val interesting = Glyph(5, "!?", "Interesting move")
      val dubious = Glyph(6, "?!", "Dubious move")
      val only = Glyph(7, "□", "Only move")
      val zugzwang = Glyph(22, "⨀", "Zugzwang")
      val all = List(good, mistake, brilliant, blunder, interesting, dubious, only, zugzwang)

    object PositionAssessment:
      val equal = Glyph(10, "=", "Equal position")
      val unclear = Glyph(13, "∞", "Unclear position")
      val redSlightlyBetter = Glyph(14, "⩲", "Red is slightly better")
      val blackSlightlyBetter = Glyph(15, "⩱", "Black is slightly better")
      val redQuiteBetter = Glyph(16, "±", "Red is better")
      val blackQuiteBetter = Glyph(17, "∓", "Black is better")
      val redMuchBetter = Glyph(18, "+−", "Red is winning")
      val blackMuchBetter = Glyph(19, "−+", "Black is winning")
      val all = List(
        equal,
        unclear,
        redSlightlyBetter,
        blackSlightlyBetter,
        redQuiteBetter,
        blackQuiteBetter,
        redMuchBetter,
        blackMuchBetter
      )

    object Observation:
      val novelty = Glyph(146, "N", "Novelty")
      val development = Glyph(32, "↑↑", "Development")
      val initiative = Glyph(36, "↑", "Initiative")
      val attack = Glyph(40, "→", "Attack")
      val counterplay = Glyph(132, "⇆", "Counterplay")
      val timeTrouble = Glyph(138, "⊕", "Time trouble")
      val compensation = Glyph(44, "=∞", "With compensation")
      val withIdea = Glyph(140, "∆", "With the idea")
      val all =
        List(novelty, development, initiative, attack, counterplay, timeTrouble, compensation, withIdea)

    // Categories construct Glyphs while their companion is initializing. Build the index only
    // after that construction finishes, regardless of which category is accessed first.
    private lazy val known =
      (MoveAssessment.all ::: PositionAssessment.all ::: Observation.all).map(g => g.id -> g).toMap
    def find(id: Int): Option[Glyph] =
      Option.when(id >= 0 && id <= 255)(known.getOrElse(id, Glyph(id, s"$$$id", s"$$$id")))
    def fromId(id: Int): Glyph =
      find(id).getOrElse(throw IllegalArgumentException(s"Invalid annotation glyph: $id"))
    private[XiangqiGlyph] def category(g: Glyph): Int =
      if MoveAssessment.all.exists(_.id == g.id) then 1
      else if PositionAssessment.all.exists(_.id == g.id) then 2
      else 0
    given OWrites[Glyph] = Json.writes

  case class Glyphs private (toList: List[Glyph]):
    def nonEmpty: Option[Glyphs] = Option.when(toList.nonEmpty)(this)
    def move: Option[Glyph] = toList.find(g => Glyph.category(g) == 1)
    def merge(other: Glyphs): Glyphs = Glyphs.fromList(toList ::: other.toList)
    def toggle(glyph: Glyph): Glyphs =
      if toList.exists(_.id == glyph.id) then Glyphs(toList.filterNot(_.id == glyph.id))
      else
        val category = Glyph.category(glyph)
        Glyphs(toList.filterNot(g => category != 0 && Glyph.category(g) == category) :+ glyph)

  object Glyphs:
    val empty = Glyphs(Nil)
    def fromList(glyphs: List[Glyph]): Glyphs = Glyphs(glyphs.distinctBy(_.id))
    def fromIds(ids: Iterable[Int]): Glyphs = fromList(ids.iterator.map(Glyph.fromId).toList)
    given Writes[Glyphs] = Writes(g => Json.toJson(g.toList))
