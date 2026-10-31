package lila.tournament

import lila.threeKingdoms.{ Position, Rules, Kingdom, TournamentResult }
import arena.Sheet

class ThreeKingdomsTournamentTest extends munit.FunSuite:
  private val now = java.time.Instant.parse("2026-10-30T00:00:00Z")
  private val users = (1 to 9).map(i => UserId(s"user$i")).toList
  private val waiting = users.zipWithIndex.map((u, i) => u -> now.plusSeconds(i)).toMap
  private val rank = users.zipWithIndex.toMap

  test("triples pair every user at most once and preserve incomplete waiting groups"):
    val groups = ThreeKingdomsPairing.groups(waiting, rank, Nil)
    assertEquals(groups.size, 3)
    assertEquals(groups.flatten.toSet, users.toSet)
    assertEquals(groups.flatten.distinct.size, 9)
    assertEquals(ThreeKingdomsPairing.groups(waiting - users.last, rank, Nil).flatten.size, 6)

  test("team battles need three distinct teams and do not strand an eligible later group"):
    val teams = users.zipWithIndex.map((u, i) => u -> TeamId(s"team${i % 3}")).toMap
    val groups = ThreeKingdomsPairing.groups(waiting, rank, Nil, Some(teams))
    assertEquals(groups.size, 3)
    assert(groups.forall(_.map(teams).distinct.size == 3))
    assertEquals(
      ThreeKingdomsPairing.groups(waiting, rank, Nil, Some(teams.view.mapValues(_ => TeamId("same")).toMap)),
      Nil
    )

  test("placement points include a tied final duel and replayed results are idempotent"):
    val duel = Rules.withdraw(Position.initial, Kingdom.Shu).toOption.get.position
    val drawn = Rules.agreeDraw(duel).toOption.get
    val result = TournamentResult(GameId("test0001"), users.take(3).toVector, drawn, now, now)
    assertEquals(users.take(3).map(result.points), List(Some(3), Some(3), Some(0)))
    val sheet = Sheet.empty(chess.variant.Standard).addPlacement(result.id, 3).addPlacement(result.id, 3)
    assertEquals(sheet.total, 3)
    assertEquals(sheet.scoresToString, "3")
    assert(!sheet.isOnFire)
    assertEquals((0 to 4).map(Sheet.Score.placement(_).value).toList, (0 to 4).toList)

  test("seat balancing rotates the first mover across repeated triples"):
    val ids = users.take(3).toVector
    val history = List(TournamentResult(GameId("test0002"), ids, Position.initial, now, now))
    val groups = ThreeKingdomsPairing.groups(waiting.filter((u, _) => ids.contains(u)), rank, history)
    assert(groups.head.zipWithIndex.forall((u, i) => ids(i) != u))
