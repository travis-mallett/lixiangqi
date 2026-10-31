package lila.tournament

import chess.{ Clock, Rated }
import lila.core.tournament.Status
import lila.gathering.Condition.AllowList
import lila.xiangqi.{ GameVariant, Xiangqi }
import lila.xiangqi.adjudication.Ruleset

class TournamentAuditTest extends munit.FunSuite:
  private def tour = Tournament(
    id = TourId("audit001"),
    name = "Audit",
    status = Status.created,
    clock = Clock.Config(Clock.LimitSeconds(120), Clock.IncrementSeconds(1)),
    minutes = 20,
    variant = chess.variant.Standard,
    position = None,
    rated = Rated.No,
    conditions = TournamentCondition.All.empty,
    schedule = None,
    nbPlayers = 0,
    createdAt = nowInstant,
    createdBy = UserId.lichess,
    startsAt = nowInstant.plusMinutes(10)
  )

  test("native variants own their initial position and repetition policy"):
    val setup = TournamentForm().fillFromTour(tour).copy(gameVariant = Some("jieqi"))
    val changed = setup.updateAll(tour)
    assertEquals(changed.gameVariant, GameVariant.Jieqi)
    assertEquals(changed.ruleset, Ruleset.Jieqi)
    val game = changed.gameVariant.initialGame(None, changed.ruleset).toOption.get
    assert(game.state.fen.contains("x"))
    assert(GameVariant.Xiangqi.initialGame(None, Ruleset.Jieqi).isLeft)
    assert(GameVariant.Jieqi.initialGame(Some(Xiangqi.startFen), Ruleset.Jieqi).isLeft)
    assertEquals(changed.rankTrack, lila.core.rank.RankTrackId.jieqi)

  test("native variant survives storage and partial edits"):
    val original = tour.copy(gameVariant = GameVariant.Jieqi, ruleset = Ruleset.Jieqi)
    val handler = BSONHandlers.tourHandler
    assertEquals(handler.readDocument(handler.writeTry(original).get).get.gameVariant, GameVariant.Jieqi)
    val edit = TournamentForm().fillFromTour(original).copy(gameVariant = None, variant = None)
    assertEquals(edit.updatePresent(original).gameVariant, GameVariant.Jieqi)
    assertEquals(edit.updatePresent(original).ruleset, Ruleset.Jieqi)
    assertEquals(
      edit.copy(ruleset = Some(Ruleset.Tiantian.key)).updatePresent(original).ruleset,
      Ruleset.Jieqi
    )
    assertEquals(handler.readDocument(handler.writeTry(tour).get).get.gameVariant, GameVariant.Xiangqi)

  test("scheduled events preserve their organizer's entry conditions"):
    val restricted = tour.copy(
      schedule = Some(Scheduled(Schedule.Freq.Unique, tour.startsAt.dateTime)),
      conditions = TournamentCondition.All.empty.copy(allowList = Some(AllowList("allowed")))
    )
    val handler = BSONHandlers.tourHandler
    assertEquals(handler.readDocument(handler.writeTry(restricted).get).get.conditions, restricted.conditions)

  test("changing native variant in a partial edit clears the old variant's custom position"):
    val original = tour.copy(position = Some(chess.format.Fen.Standard(Xiangqi.startFen)))
    val edit =
      TournamentForm().fillFromTour(original).copy(gameVariant = Some("minixiangqi"), position = None)
    val updated = edit.updatePresent(original)
    assertEquals(updated.gameVariant, GameVariant.MiniXiangqi)
    assertEquals(updated.position, None)
    assert(updated.gameVariant.initialGame(updated.position.map(_.value), updated.ruleset).isRight)

  test("joined players freeze the exact clock, position, variant and rules"):
    val joined = tour.copy(nbPlayers = 1)
    val edit = TournamentForm()
      .fillFromTour(joined)
      .copy(
        clockTime = 3,
        clockIncrement = Clock.IncrementSeconds(2),
        gameVariant = Some("jieqi"),
        ruleset = Some(Ruleset.Unrestricted.key)
      )
    for result <- List(edit.updateAll(joined), edit.updatePresent(joined)) do
      assertEquals(result.clock, joined.clock)
      assertEquals(result.gameVariant, joined.gameVariant)
      assertEquals(result.ruleset, joined.ruleset)
      assertEquals(result.position, joined.position)

  test("scoring features cannot change during play"):
    val started = tour.copy(status = Status.started)
    val edit =
      TournamentForm().fillFromTour(started).copy(berserkable = Some(false), streakable = Some(false))
    for result <- List(edit.updateAll(started), edit.updatePresent(started)) do
      assertEquals(result.berserkable, started.berserkable)
      assertEquals(result.streakable, started.streakable)

  test("a player's first pause starts its delay at that pause"):
    val pause = new Pause(using scala.concurrent.ExecutionContext.global)
    pause.add(UserId("first"))
    Thread.sleep(2100)
    val later = UserId("later")
    pause.add(later)
    assert(pause.remainingDelay(later, tour).exists(_.value >= 9))
    assert(!pause.canJoin(later, tour.copy(status = Status.started)))

  private def pairing(id: String, winner: Option[UserId], turns: Int = 60, berserk: Boolean = false) =
    Pairing(
      GameId(id),
      tour.id,
      chess.Status.Mate,
      UserId("red"),
      UserId("black"),
      winner,
      Some(turns),
      berserk,
      false
    )
  private def add(sheet: arena.Sheet, result: Pairing) = sheet.addResult(
    UserId("red"),
    result,
    arena.Sheet.Version.V2,
    arena.Sheet.Streakable(true),
    lila.core.LightUser.IsBotSync(_ => false)
  )

  test("duplicate results and a cache loaded during completion cannot score twice"):
    val result = pairing("result01", Some(UserId("red")))
    val once = add(arena.Sheet.empty(chess.variant.Standard), result)
    assertEquals(add(once, result), once)
    assertEquals(once.total, 2)

  test("streaks, berserk eligibility and short draws retain their scoring rules"):
    val empty = arena.Sheet.empty(chess.variant.Standard)
    val first = add(empty, pairing("result01", Some(UserId("red"))))
    val second = add(first, pairing("result02", Some(UserId("red"))))
    val third = add(second, pairing("result03", Some(UserId("red")), berserk = true))
    assertEquals(third.total, 9)
    val shortDraw = add(third, pairing("result04", None, turns = 18))
    assertEquals(shortDraw.total, 9)
    assert(!shortDraw.isOnFire)
    assertEquals(add(empty, pairing("result05", Some(UserId("red")), turns = 12, berserk = true)).total, 2)
