package lila.tournament

import play.api.libs.json.*

import lila.common.Json.given
import lila.core.config.RouteUrl
import lila.core.i18n.Translate
import lila.gathering.GatheringJson.*

final class ApiJsonView(lightUserApi: lila.core.user.LightUserApi, routeUrl: RouteUrl)(using Executor):

  import JsonView.{ *, given }

  def apply(tournaments: VisibleTournaments)(using Translate): Fu[JsObject] = for
    created <- tournaments.created.map(fullJson).parallel
    started <- tournaments.started.map(fullJson).parallel
    finished <- tournaments.finished.map(fullJson).parallel
  yield Json.obj(
    "created" -> created,
    "started" -> started,
    "finished" -> finished
  )

  def calendar(tournaments: List[Tournament])(using Translate): JsObject =
    Json.obj(
      "since" -> tournaments.headOption.map(_.startsAt.withTimeAtStartOfDay),
      "to" -> tournaments.lastOption.map(_.finishesAt.withTimeAtStartOfDay.plusDays(1)),
      "tournaments" -> JsArray(tournaments.map(baseJson))
    )

  def crudCalendar(tour: Tournament)(using Translate): JsObject =
    baseJson(tour) + ("spotlight" -> Json.obj(
      "headline" -> tour.spotlight.map(_.headline),
      "homepageHours" -> tour.spotlight.flatMap(_.homepageHours),
      "manage" -> routeUrl(routes.TournamentCrud.edit(tour.id))
    ))

  private def baseJson(tour: Tournament)(using Translate): JsObject =
    Json
      .obj(
        "id" -> tour.id,
        "ruleset" -> tour.ruleset.key,
        "createdBy" -> tour.createdBy,
        "system" -> "arena", // BC
        "minutes" -> tour.minutes,
        "clock" -> tour.clock,
        "fullName" -> tour.name(),
        "nbPlayers" -> tour.nbPlayers,
        "variant" -> Json.obj(
          "key" -> tour.variant.key,
          "short" -> tour.variant.shortName,
          "name" -> tour.variant.name
        ),
        "startsAt" -> tour.startsAt,
        "finishesAt" -> tour.finishesAt,
        "status" -> tour.status.id,
        "perf" -> nativePerfJson
      )
      .add("secondsToStart", tour.secondsToStart.some.filter(_.nonZero))
      .add("onlyTitled", tour.conditions.titled.isDefined)
      .add("teamMember", tour.singleTeamId)
      .add("private", tour.isPrivate)
      .add("position", tour.position.map(position))
      .add("payouts", tour.payouts)
      .add("schedule", tour.scheduleData.map(scheduleJson))
      .add(
        "teamBattle",
        tour.teamBattle.map { battle =>
          Json.obj(
            "teams" -> battle.teams,
            "nbLeaders" -> battle.nbLeaders
          )
        }
      )

  def fullJson(tour: Tournament)(using Translate): Fu[JsObject] =
    tour.winnerId.so(lightUserApi.async).map { winner =>
      baseJson(tour).add("winner" -> winner)
    }

  def byPlayer(e: LeaderboardApi.TourEntry)(using Translate): JsObject =
    Json.obj(
      "tournament" -> baseJson(e.tour),
      "player" -> Json
        .obj(
          "games" -> e.entry.nbGames,
          "score" -> e.entry.score,
          "rank" -> e.entry.rank
        )
    )

  private val nativePerfJson = Json.obj(
    "key" -> "xiangqi",
    "name" -> "Xiangqi",
    "position" -> 0
  )
