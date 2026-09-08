package lila.xiangqi.adjudication

import lila.xiangqi.Xiangqi.*

/** Policy-only facts: these intentionally isolate sequence arithmetic from legal board histories. */
class TiantianSequenceBoundaryTest extends munit.FunSuite:
  private def check(side: Side, ids: String*) =
    MoveFact(side, "moved-screen", ids.toVector, Vector.empty, Vector.empty, false, false)
  private def chase(side: Side, id: String, targets: String*) =
    MoveFact(side, "moved-screen", Vector.empty, Vector(id), targets.toVector, false, false)
  private def quiet(side: Side) =
    MoveFact(side, "quiet", Vector.empty, Vector.empty, Vector.empty, false, false)

  private def boundary(
      prefix: Vector[MoveFact],
      run: Vector[MoveFact],
      next: MoveFact,
      reason: String
  ): Unit =
    assertEquals(TiantianSequences.forbidden(prefix ++ run.dropRight(1), run.last), None)
    assertEquals(TiantianSequences.forbidden(prefix ++ run, next), Some(reason))

  for side <- Side.values do
    test(s"$side: physical checking identities, double checks, extensions and cap"):
      for count <- 1 to 4 do
        val limit = 6 * count.min(3)
        val run = Vector.tabulate(limit)(i => check(side, s"checker${i % count}"))
        boundary(Vector.empty, run, run.head, "perpetual-check")
        val freshSingle = Vector.fill(6)(check(side, "checker0"))
        boundary(run :+ quiet(side), freshSingle, freshSingle.head, "perpetual-check")
      val double = check(side, "a", "b")
      boundary(Vector.empty, Vector.fill(12)(double), double, "perpetual-check")
      assertEquals(TiantianSequences.forbidden(Vector.fill(6)(check(side, "a")), check(side, "b")), None)
      assertEquals(TiantianSequences.forbidden(Vector.fill(12)(double), check(side, "c")), None)
      assertEquals(
        TiantianSequences.forbidden(Vector.fill(18)(check(side, "a", "b", "c")), check(side, "d")),
        Some("perpetual-check")
      )
      val changingMover = Vector.tabulate(6)(i => check(side, "a").copy(piece = s"screen$i"))
      assertEquals(TiantianSequences.forbidden(changingMover, check(side, "a")), Some("perpetual-check"))

    test(s"$side: own quiet or chase restarts checks; opponent quiet does not"):
      val run = Vector.fill(6)(check(side, "a"))
      for breakMove <- Vector(quiet(side), chase(side, "a", "target")) do
        val prefix = run :+ breakMove
        assertEquals(TiantianSequences.forbidden(prefix, run.head), None)
        boundary(prefix, run, run.head, "perpetual-check")
      assertEquals(TiantianSequences.forbidden(run :+ quiet(!side), run.head), Some("perpetual-check"))

    test(s"$side: chasing counts the common physical target, not attacking pieces"):
      val run = Vector.tabulate(6)(i => chase(side, s"attacker${i % 2}", "target"))
      boundary(Vector.empty, run, run.head, "perpetual-chase")
      for breakMove <- Vector(quiet(side), check(side, "a"), chase(side, "a", "other")) do
        assertEquals(TiantianSequences.forbidden(run :+ breakMove, run.head), None)
        boundary(run :+ breakMove, run, run.head, "perpetual-chase")
      val newRun = Vector.fill(6)(chase(side, "a", "new-target"))
      boundary(run, newRun, newRun.head, "perpetual-chase")
      val common = Vector.tabulate(6)(i => chase(side, "a", "common", s"other${i % 2}"))
      boundary(Vector.empty, common, chase(side, "b", "common"), "perpetual-chase")
      val pairwise =
        Vector(chase(side, "a", "x", "y"), chase(side, "a", "y", "z"), chase(side, "a", "x", "z"))
      assertEquals(TiantianSequences.forbidden(Vector.fill(2)(pairwise).flatten, pairwise.head), None)

    test(s"$side: alternating boundaries, both phases, quiet and same-category restarts"):
      for
        multiple <- Vector(false, true)
        startsCheck <- Vector(false, true)
      do
        val limit = if multiple then 18 else 12
        val c = check(side, "a")
        val h = chase(side, if multiple then "b" else "a", "target")
        val run = Vector.tabulate(limit)(i => if (i % 2 == 0) == startsCheck then c else h)
        boundary(Vector.empty, run, run.head, "alternating-check-chase")
        boundary(run :+ quiet(side), run, run.head, "alternating-check-chase")
        // Repeating the old final category breaks alternation. The new run starts with that category.
        val restarted = run.reverse
        boundary(run, restarted, restarted.head, "alternating-check-chase")
        assertEquals(TiantianSequences.forbidden(run, run.head.copy(capture = true)), None)

    test(s"$side: checking priority begins at two opponent checks and ends on a quiet reply"):
      val run = Vector.fill(6)(chase(side, "a", "target"))
      val one = run :+ check(!side, "opponent")
      assertEquals(TiantianSequences.forbidden(one, run.head), Some("perpetual-chase"))
      val two = one :+ check(!side, "opponent")
      assertEquals(TiantianSequences.forbidden(two, run.head), None)
      assertEquals(TiantianSequences.forbidden(two :+ quiet(!side), run.head), Some("perpetual-chase"))
      assertEquals(TiantianSequences.forbidden(run, check(!side, "opponent")), None)

  test("mutual forcing requires six own turns each and one common chase target for each side"):
    for
      redCount <- Vector(5, 6, 7)
      blackCount <- Vector(5, 6, 7)
    do
      val checks =
        Vector.fill(redCount)(check(Side.Red, "r")) ++ Vector.fill(blackCount)(check(Side.Black, "b"))
      val chases = Vector.fill(redCount)(chase(Side.Red, "r", "b")) ++ Vector.fill(blackCount)(
        chase(Side.Black, "b", "r")
      )
      val expected = redCount >= 6 && blackCount >= 6
      assertEquals(TiantianSequences.mutual(checks, _.check), expected)
      assertEquals(TiantianSequences.mutualChase(chases), expected)
      assert(!TiantianSequences.mutual(checks :+ quiet(Side.Red), _.check))
      assert(!TiantianSequences.mutualChase(chases :+ chase(Side.Black, "b", "different-red-piece")))
