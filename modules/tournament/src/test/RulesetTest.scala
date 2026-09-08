package lila.tournament

import chess.{ Clock, Rated }
import lila.core.tournament.Status
import lila.xiangqi.adjudication.Ruleset

class RulesetTest extends munit.FunSuite:
  private def tournament = Tournament(
    id = TourId("rules001"), name = "Rules test", status = Status.created,
    clock = Clock.Config(Clock.LimitSeconds(300), Clock.IncrementSeconds(0)),
    minutes = 45, variant = chess.variant.Standard, position = None, rated = Rated.No,
    conditions = TournamentCondition.All.empty, schedule = None, nbPlayers = 0,
    createdAt = nowInstant, createdBy = UserId.lichess, startsAt = nowInstant.plusMinutes(10)
  )

  test("tournaments default to Tiantian and freeze selection before play"):
    val tour = tournament
    assertEquals(tour.ruleset, Ruleset.Tiantian)
    val setup = TournamentForm().fillFromTour(tour).copy(ruleset = Some(Ruleset.Unrestricted.key))
    assertEquals(setup.updateAll(tour).ruleset, Ruleset.Unrestricted)
    assertEquals(setup.updatePresent(tour).ruleset, Ruleset.Unrestricted)
    assertEquals(setup.updateAll(tour.copy(nbPlayers = 1)).ruleset, Ruleset.Tiantian)
    assertEquals(setup.updatePresent(tour.copy(status = Status.started)).ruleset, Ruleset.Tiantian)

  test("tournament policy survives storage and old started events retain historical rules"):
    val handler = BSONHandlers.tourHandler
    val doc = handler.writeTry(tournament.copy(ruleset = Ruleset.Unrestricted)).get
    assertEquals(handler.readDocument(doc).get.ruleset, Ruleset.Unrestricted)
    val oldCreated = handler.writeTry(tournament).get -- "ruleset"
    assertEquals(handler.readDocument(oldCreated).get.ruleset, Ruleset.Tiantian)
    val oldStarted = handler.writeTry(tournament.copy(status = Status.started)).get -- "ruleset"
    assertEquals(handler.readDocument(oldStarted).get.ruleset, Ruleset.Unrestricted)
