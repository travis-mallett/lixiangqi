package lila.pref

import munit.FunSuite

class PrefFormTest extends FunSuite:

  test("a complete account display update binds and preserves privacy preferences"):
    val current = Pref.default.copy(follow = false)
    val data = PrefForm.prefOf(current).data.updated("display.coords", Pref.Coords.OUTSIDE.toString)

    val bound = PrefForm.pref(lichobile = false).bind(data)
    assert(!bound.hasErrors, bound.errors.toString)

    val saved = bound.value.get.apply(current)
    assertEquals(saved.coords, Pref.Coords.OUTSIDE)
    assertEquals(saved.follow, current.follow)
    assertEquals(saved.challenge, current.challenge)
    assertEquals(saved.message, current.message)
    assertEquals(saved.studyInvite, current.studyInvite)

  test("missing insight-share field preserves the existing privacy preference"):
    List(0, 1, 2).foreach: insightShare =>
      val current = Pref.default.copy(insightShare = insightShare)
      val incomplete = PrefForm.prefOf(current).data - "insightShare"
      val bound = PrefForm.pref(lichobile = false).bind(incomplete)

      assert(!bound.hasErrors, bound.errors.toString)
      val saved = bound.value.get.apply(current)
      assertEquals(saved.insightShare, insightShare)
      assertEquals(saved.follow, current.follow)
      assertEquals(saved.challenge, current.challenge)
      assertEquals(saved.message, current.message)
      assertEquals(saved.studyInvite, current.studyInvite)

  test("an explicitly submitted insight-share value is still honored"):
    val current = Pref.default.copy(insightShare = 2)
    val data = PrefForm.prefOf(current).data.updated("insightShare", "0")
    val bound = PrefForm.pref(lichobile = false).bind(data)

    assert(!bound.hasErrors, bound.errors.toString)
    assertEquals(bound.value.get.apply(current).insightShare, 0)

  test("an explicit insight-share update can select value 2"):
    val current = Pref.default.copy(insightShare = 0)
    val data = PrefForm.prefOf(current).data.updated("insightShare", "2")
    val bound = PrefForm.pref(lichobile = false).bind(data)

    assert(!bound.hasErrors, bound.errors.toString)
    assertEquals(bound.value.get.apply(current).insightShare, 2)

  test("invalid insight-share values are rejected"):
    val current = Pref.default
    List("-1", "3", "not-a-number").foreach: value =>
      val data = PrefForm.prefOf(current).data.updated("insightShare", value)
      val bound = PrefForm.pref(lichobile = false).bind(data)

      assert(bound.hasErrors, s"Expected invalid insightShare=$value to fail form binding")
