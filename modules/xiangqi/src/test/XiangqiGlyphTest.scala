package lila.xiangqi

import XiangqiGlyph.*

class XiangqiGlyphTest extends munit.FunSuite:
  test("annotation menu categories initialize before the numeric lookup"):
    val menu = Glyph.MoveAssessment.all ::: Glyph.PositionAssessment.all ::: Glyph.Observation.all
    assertEquals(menu.size, 24)
    assertEquals(menu.map(_.id).distinct.size, menu.size)
    menu.foreach(glyph => assertEquals(Glyph.find(glyph.id), Some(glyph)))
    assertEquals(Glyph.PositionAssessment.redSlightlyBetter.name, "Red is slightly better")

  test("all valid annotation IDs retain independent numeric identities"):
    val glyphs = Glyphs.fromIds(0 to 255)
    assertEquals(glyphs.toList.map(_.id), (0 to 255).toList)
    assertEquals(glyphs.merge(glyphs), glyphs)
    assertEquals(Glyph.fromId(255).symbol, "$255")
    assert(Glyph.find(-1).isEmpty)
    assert(Glyph.find(256).isEmpty)

  test("menu toggling replaces only the corresponding assessment category"):
    val glyphs = Glyphs.fromList(List(Glyph.MoveAssessment.good, Glyph.Observation.attack, Glyph.fromId(255)))
    assertEquals(glyphs.toggle(Glyph.MoveAssessment.blunder).toList.map(_.id), List(40, 255, 4))
    assertEquals(glyphs.toggle(Glyph.MoveAssessment.good).toList.map(_.id), List(40, 255))
