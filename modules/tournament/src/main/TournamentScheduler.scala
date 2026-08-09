package lila.tournament

import java.time.DayOfWeek.*
import java.time.Month.*
import java.time.temporal.TemporalAdjusters
import java.time.{ LocalDate, LocalDateTime, LocalTime }

import lila.common.LilaScheduler
import lila.core.i18n.Translator

final private class TournamentScheduler(tournamentRepo: TournamentRepo)(using
    Executor,
    Scheduler,
    Translator
):

  LilaScheduler("TournamentScheduler", _.Every(5.minutes), _.AtMost(1.minute), _.Delay(1.minute)):
    given play.api.i18n.Lang = lila.core.i18n.defaultLang
    tournamentRepo.scheduledUnfinished.flatMap: dbScheds =>
      try
        val newPlans = TournamentScheduler.allWithConflicts()
        val tourneysToAdd = PlanBuilder.getNewTourneys(dbScheds, newPlans)
        tournamentRepo.insert(tourneysToAdd).logFailure(logger)
      catch
        case e: Exception =>
          logger.error(s"failed to schedule all: ${e.getMessage}")
          funit

private object TournamentScheduler:

  import Schedule.Freq.*
  import Schedule.Speed.*
  import Schedule.Plan
  import chess.variant.Standard

  /* Month plan:
   * First week: Shield standard tournaments
   * Second week: Yearly tournament
   * Third week: additional community tournaments
   * Last week: Monthly tournaments
   */

  // def marathonDates = List(
  // Spring -> Saturday of the weekend after Orthodox Easter Sunday
  // Summer -> first Saturday of August
  // Autumn -> Saturday of weekend before the weekend Halloween falls on (c.f. half-term holidays)
  // Winter -> 28 December, convenient day in the space between Boxing Day and New Year's Day
  // )
  def allWithConflicts(rightNow: LocalDateTime = nowDateTime): List[Plan] =
    val today = rightNow.date
    val startOfYear = today.withDayOfYear(1)

    class OfMonth(fromNow: Int):
      val firstDay = today.plusMonths(fromNow).withDayOfMonth(1)
      val lastDay = firstDay.adjust(TemporalAdjusters.lastDayOfMonth)
      val firstWeek = firstDay.plusDays(7 - (firstDay.getDayOfWeek.getValue - 1))
      val lastWeek = lastDay.minusDays(lastDay.getDayOfWeek.getValue - 1)
    val thisMonth = OfMonth(0)
    val nextMonth = OfMonth(1)

    def nextDayOfWeek(n: Int) = today.plusDays((n + 7 - today.getDayOfWeek.getValue) % 7)
    val nextMonday = nextDayOfWeek(1)
    val nextTuesday = nextDayOfWeek(2)
    val nextWednesday = nextDayOfWeek(3)
    val nextThursday = nextDayOfWeek(4)
    val nextFriday = nextDayOfWeek(5)
    val nextSaturday = nextDayOfWeek(6)
    val nextSunday = nextDayOfWeek(7)

    def secondWeekOf(month: java.time.Month): LocalDate =
      val start = startOfYear.withMonth(month.getValue).pipe(orNextYearDate)
      start.plusDays(15 - start.getDayOfWeek.getValue)

    def orTomorrow(date: LocalDateTime) = if date.isBefore(rightNow) then date.plusDays(1) else date
    def orNextWeek(date: LocalDateTime) = if date.isBefore(rightNow) then date.plusWeeks(1) else date
    def orNextYear(date: LocalDateTime) = if date.isBefore(rightNow) then date.plusYears(1) else date
    def orNextYearDate(date: LocalDate) = if date.isBefore(today) then date.plusYears(1) else date

    val farFuture = today.plusMonths(7).atStartOfDay

    val birthday = LocalDate.of(2010, 6, 20)

    extension (date: LocalDate)
      def withDayOfWeek(day: java.time.DayOfWeek): LocalDate =
        date.adjust(TemporalAdjusters.nextOrSame(day))

    // all dates UTC
    List(
      List( // legendary tournaments!
        at(birthday.withYear(today.getYear), 12).pipe(orNextYear).pipe { date =>
          val yo = date.getYear - 2010
          Schedule(Unique, Rapid, Standard, none, date).plan {
            _.copy(
              name = s"${date.getYear} Lixiangqi Anniversary",
              minutes = 12 * 60,
              description = s"""
We've had $yo great Xiangqi years together!

Thank you all, you rock!""".some,
              spotlight = Spotlight(
                headline = s"$yo years of free Xiangqi!",
                homepageHours = 24.some
              ).some
            )
          }
        }
      ),
      List( // yearly tournaments!
        secondWeekOf(JANUARY).withDayOfWeek(MONDAY) -> Bullet,
        secondWeekOf(FEBRUARY).withDayOfWeek(TUESDAY) -> SuperBlitz,
        secondWeekOf(MARCH).withDayOfWeek(WEDNESDAY) -> Blitz,
        secondWeekOf(APRIL).withDayOfWeek(THURSDAY) -> Rapid,
        secondWeekOf(MAY).withDayOfWeek(FRIDAY) -> Classical,
        secondWeekOf(JUNE).withDayOfWeek(SATURDAY) -> HyperBullet,
        secondWeekOf(JULY).withDayOfWeek(MONDAY) -> Bullet,
        secondWeekOf(AUGUST).withDayOfWeek(TUESDAY) -> SuperBlitz,
        secondWeekOf(SEPTEMBER).withDayOfWeek(WEDNESDAY) -> Blitz,
        secondWeekOf(OCTOBER).withDayOfWeek(THURSDAY) -> Rapid,
        secondWeekOf(NOVEMBER).withDayOfWeek(FRIDAY) -> Classical,
        secondWeekOf(DECEMBER).withDayOfWeek(SATURDAY) -> HyperBullet
      ).flatMap: (day, speed) =>
        at(day, 17).some.filter(farFuture.isAfter).map { date =>
          Schedule(Yearly, speed, Standard, none, date).plan
        },
      List(thisMonth, nextMonth).flatMap { month =>
        List(
          List( // monthly standard tournaments!
            month.lastWeek.withDayOfWeek(MONDAY) -> Bullet,
            month.lastWeek.withDayOfWeek(TUESDAY) -> SuperBlitz,
            month.lastWeek.withDayOfWeek(WEDNESDAY) -> Blitz,
            month.lastWeek.withDayOfWeek(THURSDAY) -> Rapid,
            month.lastWeek.withDayOfWeek(FRIDAY) -> Classical,
            month.lastWeek.withDayOfWeek(SATURDAY) -> HyperBullet,
            month.lastWeek.withDayOfWeek(SUNDAY) -> UltraBullet
          ).map: (day, speed) =>
            at(day, 17).pipe: date =>
              Schedule(Monthly, speed, Standard, none, date).plan,
          List( // shield tournaments!
            month.firstWeek.withDayOfWeek(MONDAY) -> Bullet,
            month.firstWeek.withDayOfWeek(TUESDAY) -> SuperBlitz,
            month.firstWeek.withDayOfWeek(WEDNESDAY) -> Blitz,
            month.firstWeek.withDayOfWeek(THURSDAY) -> Rapid,
            month.firstWeek.withDayOfWeek(FRIDAY) -> Classical,
            month.firstWeek.withDayOfWeek(SATURDAY) -> HyperBullet,
            month.firstWeek.withDayOfWeek(SUNDAY) -> UltraBullet
          ).map: (day, speed) =>
            at(day, 16).pipe: date =>
              Schedule(Shield, speed, Standard, none, date).plan(TournamentShield.make(speed.toString))
        ).flatten
      },
      List( // weekly standard tournaments!
        nextMonday -> Bullet,
        nextTuesday -> SuperBlitz,
        nextWednesday -> Blitz,
        nextThursday -> Rapid,
        nextFriday -> Classical,
        nextSaturday -> HyperBullet,
        nextSunday -> UltraBullet
      ).map: (day, speed) =>
        at(day, 17).pipe: date =>
          Schedule(Weekly, speed, Standard, none, date.pipe(orNextWeek)).plan,
      List( // week-end elite tournaments!
        nextSaturday -> SuperBlitz,
        nextSunday -> Bullet
      ).map: (day, speed) =>
        at(day, 17).pipe: date =>
          Schedule(Weekend, speed, Standard, none, date).plan,
      // Note: these should be scheduled close to the hour of weekly or weekend tournaments
      // to avoid two dailies being cancelled in a row from a single higher importance tourney
      List( // daily tournaments!
        at(today, 16).pipe: date =>
          Schedule(Daily, Bullet, Standard, none, date.pipe(orTomorrow)).plan,
        at(today, 17).pipe: date =>
          Schedule(Daily, SuperBlitz, Standard, none, date.pipe(orTomorrow)).plan,
        at(today, 18).pipe: date =>
          Schedule(Daily, Blitz, Standard, none, date.pipe(orTomorrow)).plan,
        at(today, 19).pipe: date =>
          Schedule(Daily, Rapid, Standard, none, date.pipe(orTomorrow)).plan,
        at(today, 20).pipe: date =>
          Schedule(Daily, HyperBullet, Standard, none, date.pipe(orTomorrow)).plan,
        at(today, 21).pipe: date =>
          Schedule(Daily, UltraBullet, Standard, none, date.pipe(orTomorrow)).plan
      ),
      List( // eastern tournaments!
        at(today, 4).pipe: date =>
          Schedule(Eastern, Bullet, Standard, none, date.pipe(orTomorrow)).plan,
        at(today, 5).pipe: date =>
          Schedule(Eastern, SuperBlitz, Standard, none, date.pipe(orTomorrow)).plan,
        at(today, 6).pipe: date =>
          Schedule(Eastern, Blitz, Standard, none, date.pipe(orTomorrow)).plan
      ),
      // hourly standard tournaments!
      (-1 to 6).toList
        .flatMap { hourDelta =>
          val when = atTopOfHour(rightNow, hourDelta)
          List(
            Schedule(Hourly, HyperBullet, Standard, none, when),
            Schedule(Hourly, UltraBullet, Standard, none, when.withMinute(30)),
            Schedule(Hourly, Bullet, Standard, none, when),
            Schedule(Hourly, Bullet, Standard, none, when.withMinute(30)),
            Schedule(Hourly, SuperBlitz, Standard, none, when),
            Schedule(Hourly, Blitz, Standard, none, when)
          ) ::: {
            (when.getHour % 2 == 0).so(List(Schedule(Hourly, Rapid, Standard, none, when)))
          }
        }
        .map(_.plan),
      Nil // Entry-restricted hourly tournaments are not part of the open recurring schedule.
    ).flatten.filter(_.schedule.at.isAfter(rightNow))

  private def atTopOfHour(rightNow: LocalDateTime, hourDelta: Int): LocalDateTime =
    val withHours = rightNow.plusHours(hourDelta)
    LocalDateTime.of(withHours.date, LocalTime.of(withHours.getHour, 0))

  private type ValidHour = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
    18 | 19 | 20 | 21 | 22 | 23

  /** Get a [[LocalDateTime]].
    *
    * Note: This is safe -- impl throws only when hour is outside 0-23 or if day is null, and neither
    * condition can occur here.
    * {{{
    * assert {
    *   val hourRange = java.time.temporal.ChronoField.HOUR_OF_DAY.range()
    *   hourRange.getMinimum == 0 && hourRange.getMaximum == 23
    * }
    * }}}
    */
  private def at(day: LocalDate, hour: ValidHour): LocalDateTime =
    LocalDateTime.of(day, LocalTime.of(hour, 0))
