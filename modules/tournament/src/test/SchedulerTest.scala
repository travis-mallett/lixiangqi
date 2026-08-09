package lila.tournament

import java.time.LocalDateTime

class SchedulerTest extends munit.FunSuite:
  import ScheduleTestHelpers.{ allSchedulesAt, ExperimentalPruner }

  /** Used to update snapshots in this file (see comment at start of each test).
    */
  def _printSnapshot(plans: List[?]) =
    println(plans.mkString("      List(\"\"\"", "\"\"\",\n        \"\"\"", "\"\"\").mkString(\"\\n\")"))

  test("recurring tournaments have no entry conditions"):
    val plans = TournamentScheduler.allWithConflicts(LocalDateTime.of(2026, 8, 5, 12, 0))
    assert(plans.nonEmpty)
    assert(plans.forall(_.schedule.conditions.list.isEmpty))

  test("2024-09 - no usurps, correct daily scheduling"):
    import chess.variant.Standard
    import lila.tournament.Schedule.Speed.*
    import lila.tournament.Schedule.Freq.*

    val start = LocalDateTime.of(2024, 9, 1, 0, 0)
    val wholeMonth = TimeInterval(start.instant, start.plusMonths(1).instant)
    val daysInSept = 30
    val allSeptTourneys = ExperimentalPruner
      .pruneConflictsFailOnUsurp(
        List.empty,
        // Hour by hour schedules for the entire month.
        (-1 to (daysInSept * 24)).flatMap { hours =>
          TournamentScheduler.allWithConflicts(start.plusHours(hours))
        }
      )
      .filter(_.interval.overlaps(wholeMonth))

    //
    // If we made it here, there weren't invalid usurps! Yay!
    // Next, check that there are the proper number of special events of each type.
    //

    val dailiesOrBetter = allSeptTourneys.filter(p => p.schedule.freq.isDailyOrBetter)

    assert(allSeptTourneys.forall(_.schedule.variant == Standard))
    assert(allSeptTourneys.forall(_.schedule.position.isEmpty))

    // For Standard, there is a dedicated daily for each of the following speeds.
    List(Bullet, SuperBlitz, Blitz, Rapid, HyperBullet, UltraBullet).foreach { speed =>
      val standardSpeededDaily =
        dailiesOrBetter.filter { plan =>
          val s = plan.schedule
          s.variant.standard && s.speed == speed
        }
      // There should be exactly one special event at each of these Speeds per day.
      assertEquals(standardSpeededDaily.length, daysInSept, s"Wrong number of $speed specials")
    }

    // Easterns don't count as daily or better, so they only conflict by overlap.
    // There aren't any other special events at this time, so they should always take priority
    // over the hourlies and thus have exactly 3 per day.
    assertEquals(
      allSeptTourneys.filter(_.schedule.freq == Eastern).length,
      daysInSept * 3
    )

  test("pruneConflict methods produce identical results"):
    val prescheduled = PlanBuilder.pruneConflicts(
      List.empty,
      TournamentScheduler.allWithConflicts(LocalDateTime.of(2024, 7, 31, 23, 0))
    )
    val start = LocalDateTime.of(2024, 8, 1, 0, 0)
    val allTourneys = (0 to 23).flatMap { hours =>
      TournamentScheduler.allWithConflicts(start.plusHours(hours))
    }
    assertEquals(
      ExperimentalPruner.pruneConflictsFailOnUsurp(prescheduled, allTourneys),
      PlanBuilder.pruneConflicts(prescheduled, allTourneys)
    )

  test("end of year -- unfiltered and with conflicts"):
    // uncomment to print text for updating snapshot.
    // _printSnapshot(allSchedulesAt(LocalDateTime.of(2022, 12, 31, 21, 43)))
    assertEquals(
      allSchedulesAt(LocalDateTime.of(2022, 12, 31, 21, 43)).mkString("\n"),
      List(
        """2022-12-31T22:30:00Z Hourly standard ultraBullet(¼+0) Conditions() standard""",
        """2022-12-31T23:30:00Z Hourly standard ultraBullet(¼+0) Conditions() standard""",
        """2023-01-01T00:30:00Z Hourly standard ultraBullet(¼+0) Conditions() standard""",
        """2023-01-01T01:30:00Z Hourly standard ultraBullet(¼+0) Conditions() standard""",
        """2023-01-01T02:30:00Z Hourly standard ultraBullet(¼+0) Conditions() standard""",
        """2023-01-01T03:30:00Z Hourly standard ultraBullet(¼+0) Conditions() standard""",
        """2023-01-01T17:00:00Z Monthly standard ultraBullet(¼+0) Conditions() standard""",
        """2023-01-01T17:00:00Z Weekly standard ultraBullet(¼+0) Conditions() standard""",
        """2023-01-01T21:00:00Z Daily standard ultraBullet(¼+0) Conditions() standard""",
        """2023-01-08T16:00:00Z Shield standard ultraBullet(¼+0) Conditions() standard""",
        """2023-02-05T17:00:00Z Monthly standard ultraBullet(¼+0) Conditions() standard""",
        """2022-12-31T22:00:00Z Hourly standard hyperBullet(½+0) Conditions() standard""",
        """2022-12-31T23:00:00Z Hourly standard hyperBullet(½+0) Conditions() standard""",
        """2023-01-01T00:00:00Z Hourly standard hyperBullet(½+0) Conditions() standard""",
        """2023-01-01T01:00:00Z Hourly standard hyperBullet(½+0) Conditions() standard""",
        """2023-01-01T02:00:00Z Hourly standard hyperBullet(½+0) Conditions() standard""",
        """2023-01-01T03:00:00Z Hourly standard hyperBullet(½+0) Conditions() standard""",
        """2023-01-01T20:00:00Z Daily standard hyperBullet(½+0) Conditions() standard""",
        """2023-01-07T16:00:00Z Shield standard hyperBullet(½+0) Conditions() standard""",
        """2023-01-07T17:00:00Z Weekly standard hyperBullet(½+0) Conditions() standard""",
        """2023-02-04T17:00:00Z Monthly standard hyperBullet(½+0) Conditions() standard""",
        """2023-06-17T17:00:00Z Yearly standard hyperBullet(½+0) Conditions() standard""",
        """2022-12-31T22:00:00Z Hourly standard bullet(1+0) Conditions() standard""",
        """2022-12-31T22:30:00Z Hourly standard bullet(1+0) Conditions() standard""",
        """2022-12-31T23:00:00Z Hourly standard bullet(1+0) Conditions() standard""",
        """2022-12-31T23:30:00Z Hourly standard bullet(1+0) Conditions() standard""",
        """2023-01-01T00:00:00Z Hourly standard bullet(1+0) Conditions() standard""",
        """2023-01-01T00:30:00Z Hourly standard bullet(1+0) Conditions() standard""",
        """2023-01-01T01:00:00Z Hourly standard bullet(1+0) Conditions() standard""",
        """2023-01-01T01:30:00Z Hourly standard bullet(1+0) Conditions() standard""",
        """2023-01-01T02:00:00Z Hourly standard bullet(1+0) Conditions() standard""",
        """2023-01-01T02:30:00Z Hourly standard bullet(1+0) Conditions() standard""",
        """2023-01-01T03:00:00Z Hourly standard bullet(1+0) Conditions() standard""",
        """2023-01-01T03:30:00Z Hourly standard bullet(1+0) Conditions() standard""",
        """2023-01-01T04:00:00Z Eastern standard bullet(1+0) Conditions() standard""",
        """2023-01-01T16:00:00Z Daily standard bullet(1+0) Conditions() standard""",
        """2023-01-01T17:00:00Z Weekend standard bullet(1+0) Conditions() standard""",
        """2023-01-02T16:00:00Z Shield standard bullet(1+0) Conditions() standard""",
        """2023-01-02T17:00:00Z Weekly standard bullet(1+0) Conditions() standard""",
        """2023-01-09T17:00:00Z Yearly standard bullet(1+0) Conditions() standard""",
        """2023-01-30T17:00:00Z Monthly standard bullet(1+0) Conditions() standard""",
        """2023-07-10T17:00:00Z Yearly standard bullet(1+0) Conditions() standard""",
        """2022-12-31T22:00:00Z Hourly standard superBlitz(3+0) Conditions() standard""",
        """2022-12-31T23:00:00Z Hourly standard superBlitz(3+0) Conditions() standard""",
        """2023-01-01T00:00:00Z Hourly standard superBlitz(3+0) Conditions() standard""",
        """2023-01-01T01:00:00Z Hourly standard superBlitz(3+0) Conditions() standard""",
        """2023-01-01T02:00:00Z Hourly standard superBlitz(3+0) Conditions() standard""",
        """2023-01-01T03:00:00Z Hourly standard superBlitz(3+0) Conditions() standard""",
        """2023-01-01T05:00:00Z Eastern standard superBlitz(3+0) Conditions() standard""",
        """2023-01-01T17:00:00Z Daily standard superBlitz(3+0) Conditions() standard""",
        """2023-01-03T16:00:00Z Shield standard superBlitz(3+0) Conditions() standard""",
        """2023-01-03T17:00:00Z Weekly standard superBlitz(3+0) Conditions() standard""",
        """2023-01-31T17:00:00Z Monthly standard superBlitz(3+0) Conditions() standard""",
        """2023-02-14T17:00:00Z Yearly standard superBlitz(3+0) Conditions() standard""",
        """2022-12-31T22:00:00Z Hourly standard blitz(5+0) Conditions() standard""",
        """2022-12-31T23:00:00Z Hourly standard blitz(5+0) Conditions() standard""",
        """2023-01-01T00:00:00Z Hourly standard blitz(5+0) Conditions() standard""",
        """2023-01-01T01:00:00Z Hourly standard blitz(3+2) Conditions() standard""",
        """2023-01-01T02:00:00Z Hourly standard blitz(5+0) Conditions() standard""",
        """2023-01-01T03:00:00Z Hourly standard blitz(5+0) Conditions() standard""",
        """2023-01-01T06:00:00Z Eastern standard blitz(5+0) Conditions() standard""",
        """2023-01-01T18:00:00Z Daily standard blitz(5+0) Conditions() standard""",
        """2023-01-04T16:00:00Z Shield standard blitz(5+0) Conditions() standard""",
        """2023-01-04T17:00:00Z Weekly standard blitz(5+0) Conditions() standard""",
        """2023-02-01T17:00:00Z Monthly standard blitz(5+0) Conditions() standard""",
        """2023-03-15T17:00:00Z Yearly standard blitz(5+0) Conditions() standard""",
        """2022-12-31T22:00:00Z Hourly standard rapid(10+0) Conditions() standard""",
        """2023-01-01T00:00:00Z Hourly standard rapid(10+0) Conditions() standard""",
        """2023-01-01T02:00:00Z Hourly standard rapid(8+2) Conditions() standard""",
        """2023-01-01T19:00:00Z Daily standard rapid(10+0) Conditions() standard""",
        """2023-01-05T16:00:00Z Shield standard rapid(10+0) Conditions() standard""",
        """2023-01-05T17:00:00Z Weekly standard rapid(10+0) Conditions() standard""",
        """2023-02-02T17:00:00Z Monthly standard rapid(10+0) Conditions() standard""",
        """2023-04-13T17:00:00Z Yearly standard rapid(10+0) Conditions() standard""",
        """2023-06-20T12:00:00Z Unique standard rapid(10+0) Conditions() standard""",
        """2023-01-06T16:00:00Z Shield standard classical(20+10) Conditions() standard""",
        """2023-01-06T17:00:00Z Weekly standard classical(20+10) Conditions() standard""",
        """2023-02-03T17:00:00Z Monthly standard classical(20+10) Conditions() standard""",
        """2023-05-19T17:00:00Z Yearly standard classical(20+10) Conditions() standard"""
      ).mkString("\n")
    )
