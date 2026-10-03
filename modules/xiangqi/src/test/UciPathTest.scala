package lila.xiangqi

import play.api.libs.json.Json

import Xiangqi.*
import XiangqiJson.given

class UciPathTest extends munit.FunSuite:

  test("all 90 intersections have exactly one canonical key"):
    assertEquals(Square.all.map(_.key).distinct.size, 90)
    Square.all.foreach(square => assertEquals(Square.fromKey(square.key), Some(square)))
    List("a0", "a11", "j1", "a01", "A1", "i:", "", "a+1", "a 1", "i１０")
      .foreach(key => assertEquals(Square.fromKey(key), None))

  test("every pair of intersections round trips as a branch identity"):
    for orig <- Square.all; dest <- Square.all do
      val move = Uci.unsafe(s"${orig.key}${dest.key}")
      val path = UciPath.fromId(move)
      assertEquals(path.value, move.value)
      assertEquals(UciPath.from(path.value), Right(path))
      assertEquals(path.split, Some(move -> UciPath.root))

  test("path operations use moves rather than coordinate string widths"):
    val path = UciPath("i1i2/i10i9/a10a1")
    assertEquals(path.depth, 3)
    assertEquals(path.parent.value, "i1i2/i10i9")
    assertEquals(path.lastId.map(_.value), Some("a10a1"))
    assertEquals(path.take(1).value, "i1i2")
    assertEquals(path.drop(1).value, "i10i9/a10a1")
    assertEquals(path.drop(1).prepend(Uci.unsafe("i1i2")), path)
    assertEquals(path.parent + Uci.unsafe("a10a1"), path)
    assertEquals(path.intersect(UciPath("i1i2/i10i9/b10b1")), path.parent)
    assert(path.parent.isPrefixOf(path))
    assert(!UciPath("a1a1").isPrefixOf(UciPath("a1a10")))
    assertEquals(UciPath.root.parent, UciPath.root)
    assertEquals(UciPath.root.split, None)

  test("invalid or excessive paths fail instead of becoming a valid prefix"):
    List("/i1i2", "i1i2/", "i1i2//i10i9", "i1i2/i:i9", "i1i2/i11i9", "i1i2i10i9", " i1i2")
      .foreach(value => assert(UciPath.from(value).isLeft, value))
    assert(UciPath.from(Vector.fill(601)("a1a10").mkString("/")).isLeft)
    assertEquals(UciPath.from(Vector.fill(600)("a1a10").mkString("/")).map(_.depth), Right(600))

  test("the path transport is the canonical string and validates input"):
    val path = UciPath("a1a10/i10i1")
    assertEquals(Json.toJson(path).as[String], path.value)
    assertEquals(Json.toJson(path).as[UciPath], path)
    assert(Json.toJson("a1a10//i10i1").validate[UciPath].isError)
