package lila.tournament

import chess.Clock.{ IncrementSeconds, LimitSeconds }
import chess.format.Fen
import chess.{ Clock, Rated }
import play.api.data.*
import play.api.data.Forms.*
import play.api.libs.json.JsValue

import lila.common.Form.{ *, given }
import lila.common.Json.given
import lila.core.perm.Granter
import lila.core.team.LightTeam
import lila.gathering.GatheringClock
import lila.xiangqi.GameVariant
import lila.xiangqi.adjudication.Ruleset

final class TournamentForm:

  import TournamentForm.*
  import GatheringClock.*

  def create(leaderTeams: List[LightTeam], teamBattleId: Option[TeamId] = None, forClas: Boolean = false)(
      using me: Me
  ) =
    form(leaderTeams, none).fill(empty(teamBattleId, forClas))

  private[tournament] def empty(teamBattleId: Option[TeamId] = None, forClas: Boolean)(using me: Me) =
    TournamentSetup(
      name = teamBattleId.isEmpty.option(me.titleUsername),
      clockTime = if forClas then 5d else timeDefault,
      clockIncrement = incrementDefault,
      minutes = minuteDefault,
      waitMinutes = waitMinuteDefault.some,
      startDate = none,
      variant = chess.variant.Standard.id.toString.some,
      position = None,
      password = None,
      conditions = TournamentCondition.All.empty,
      teamBattleByTeam = teamBattleId,
      berserkable = forClas.not.some,
      streakable = forClas.not.some,
      description = none,
      payouts = none,
      hasChat = forClas.not.some
    )

  def edit(leaderTeams: List[LightTeam], tour: Tournament)(using Me) =
    form(leaderTeams, tour.some).fill(fillFromTour(tour))

  private[tournament] def fillFromTour(tour: Tournament) =
    TournamentSetup(
      name = tour.name.some,
      clockTime = tour.clock.limitInMinutes,
      clockIncrement = tour.clock.incrementSeconds,
      minutes = tour.minutes,
      waitMinutes = none,
      startDate = tour.startsAt.some,
      variant = tour.variant.id.toString.some,
      position = tour.position.map(_.into(Fen.Full)),
      password = tour.password,
      conditions = tour.conditions,
      teamBattleByTeam = none,
      berserkable = tour.berserkable.some,
      streakable = tour.streakable.some,
      description = tour.description,
      payouts = tour.payouts,
      hasChat = tour.hasChat.some,
      ruleset = tour.gameVariant.selectableRulesets.contains(tour.ruleset).option(tour.ruleset.key),
      gameVariant = tour.gameVariant.key.some
    )

  private def form(leaderTeams: List[LightTeam], prev: Option[Tournament])(using Me) =
    Form:
      val m = makeMapping(leaderTeams, prev)
      prev.fold(m): tour =>
        m
          .verifying(
            "Can't change ruleset after players have joined or play has started",
            d => d.ruleset.forall(_ == tour.ruleset.key) || tour.canChangeGame
          )
          .verifying(
            "Can't change variant after players have joined",
            d =>
              tour.canChangeGame || (
                d.variant.forall(v => guessVariant(v).contains(tour.variant)) &&
                  d.gameVariant.forall(_ == tour.gameVariant.key)
              )
          )
          .verifying(
            "Can't change time control after players have joined",
            d => d.clockConfig == tour.clock || tour.canChangeGame
          )
          .verifying(
            "Can't change position after players have joined or play has started",
            d => d.position.forall(p => tour.position.contains(p.opening)) || tour.canChangeGame
          )
          .verifying(
            "Can't change scoring rules after play has started",
            d =>
              tour.isCreated || (d.berserkable.forall(_ == tour.berserkable) &&
                d.streakable.forall(_ == tour.streakable))
          )
          .verifying(
            "Can't change bot entry condition after the tournament started",
            d => (d.conditions.allowsBots == tour.conditions.allowsBots) || tour.isCreated
          )
          .verifying(
            "Can't change start date of a team battle after 10 players have joined",
            d =>
              d.startDate.isEmpty ||
                d.startDate.contains(tour.startsAt) ||
                tour.nbPlayers < 10 ||
                tour.teamBattle.isEmpty ||
                Granter(_.ManageTournament)
          )

  private def makeMapping(leaderTeams: List[LightTeam], prev: Option[Tournament])(using me: Me) =
    val manager = Granter(_.ManageTournament)
    val nameMaxLength = if me.isVerified || manager then 35 else 30
    mapping(
      "name" -> optional(eventName(2, nameMaxLength, manager || me.isVerified)),
      "clockTime" -> numberInDouble(timeChoices),
      "clockIncrement" -> numberIn(incrementChoices).into[IncrementSeconds],
      "minutes" -> {
        if manager then number(min = 1, max = 7 * 24 * 60)
        else numberIn(minuteChoicesKeepingCustom(prev))
      },
      "waitMinutes" -> optional(numberIn(waitMinuteChoices)),
      "startDate" -> optional(
        ISOInstantOrTimestamp.mapping.verifying(
          "Must be in the future",
          date => date.isAfter(nowInstant) || prev.exists(_.startsAt == date)
        )
      ),
      "variant" -> optional(text.verifying(v => guessVariant(v).isDefined)),
      "position" -> optional(lila.common.Form.fen.playableStrict),
      "password" -> optional(cleanNonEmptyText),
      "conditions" -> TournamentCondition.form.all(leaderTeams),
      "teamBattleByTeam" -> optional(of[TeamId].verifying(id => leaderTeams.exists(_.id == id))),
      "berserkable" -> optional(boolean),
      "streakable" -> optional(boolean),
      "description" -> optional(cleanNonEmptyText),
      "payouts" -> (if manager then optional(cleanNonEmptyText.into[Payouts]) else ignored(none)),
      "hasChat" -> optional(boolean),
      "ruleset" -> optional(
        text.verifying(v => Ruleset.fromKey(v).exists(GameVariant.Xiangqi.selectableRulesets.contains))
      ),
      "gameVariant" -> optional(text.verifying(v => GameVariant.fromKey(v).isRight))
    )(TournamentSetup.apply)(unapply)
      .verifying("Invalid clock", _.validClock(prev))
      .verifying("Invalid clock for bot games", _.validClockForBots(prev))
      .verifying("Increase tournament duration, or decrease game clock", _.sufficientDuration(prev))
      .verifying("Reduce tournament duration, or increase game clock", _.excessiveDuration(prev))
      .verifying(
        "This variant does not support a custom position",
        d =>
          val variant = d.effectiveGameVariant(prev)
          d.position.forall(fen =>
            variant.supportsCustomPosition &&
              lila.xiangqi.Xiangqi.Fen.board(fen.value).exists(_.variant == variant)
          )
      )
      .verifying(
        "Repetition rules do not apply to this variant",
        d => d.ruleset.forall(key => d.effectiveGameVariant(prev).selectableRulesets.exists(_.key == key))
      )

object TournamentForm:

  import chess.variant.{ Standard, Variant }

  val minutes = (20 to 60 by 5) ++ (70 to 120 by 10) ++ (150 to 360 by 30) ++ (420 to 600 by 60) :+ 720
  val minuteDefault = 45
  val minuteChoices = options(minutes, "%d minute{s}")
  def minuteChoicesKeepingCustom(prev: Option[Tournament]) = prev.fold(minuteChoices): tour =>
    if minuteChoices.exists(_._1 == tour.minutes) then minuteChoices
    else minuteChoices ++ List(tour.minutes -> s"${tour.minutes} minutes")

  val waitMinutes = Seq(1, 2, 3, 5, 10, 15, 20, 30, 45, 60)
  val waitMinuteChoices = options(waitMinutes, "%d minute{s}")
  val waitMinuteDefault = 5

  val validVariants = List(Standard)

  def guessVariant(from: String): Option[Variant] =
    validVariants.find: v =>
      v.key.value == from || from.toIntOption.exists(v.id.value == _)

  val joinForm = Form:
    mapping(
      "team" -> optional(nonEmptyText.into[TeamId]),
      "password" -> optional(nonEmptyText),
      "pairMeAsap" -> optional(boolean)
    )(TournamentJoin.apply)(unapply)

  case class TournamentJoin(
      team: Option[TeamId],
      password: Option[String],
      pairMeAsap: Option[Boolean] = None
  )
  def tournamentJoin(js: JsValue) = TournamentJoin(
    password = js.\("p").asOpt[String],
    team = js.\("team").asOpt[TeamId]
  )

private[tournament] case class TournamentSetup(
    name: Option[String],
    clockTime: Double,
    clockIncrement: IncrementSeconds,
    minutes: Int,
    waitMinutes: Option[Int],
    startDate: Option[Instant],
    variant: Option[String],
    position: Option[Fen.Full],
    password: Option[String],
    conditions: TournamentCondition.All,
    teamBattleByTeam: Option[TeamId],
    berserkable: Option[Boolean],
    streakable: Option[Boolean],
    description: Option[String],
    payouts: Option[Payouts],
    hasChat: Option[Boolean],
    ruleset: Option[String] = None,
    gameVariant: Option[String] = None
):
  def realGameVariant =
    gameVariant.fold(GameVariant.Xiangqi)(GameVariant.fromKey(_).fold(sys.error, identity))
  def effectiveGameVariant(prev: Option[Tournament]) =
    if gameVariant.isDefined then realGameVariant else prev.fold(GameVariant.Xiangqi)(_.gameVariant)
  private def rulesetFor(variant: GameVariant) =
    ruleset
      .flatMap(Ruleset.fromKey(_).toOption)
      .filter(variant.selectableRulesets.contains) | variant.defaultRuleset

  def realRuleset = rulesetFor(realGameVariant)

  private def updatedRuleset(old: Tournament) =
    if !old.canChangeGame then old.ruleset
    else if gameVariant.exists(_ != old.gameVariant.key) || ruleset.isDefined then
      rulesetFor(if gameVariant.isDefined then realGameVariant else old.gameVariant)
    else old.ruleset
  def validClock(prev: Option[Tournament]) =
    if effectiveGameVariant(prev) == GameVariant.ThreeKingdoms then
      Set(7d, 10d, 15d).contains(clockTime) && clockIncrement.value == 0
    else sameClock(prev) || (clockTime + clockIncrement.value) > 0

  def validClockForBots(prev: Option[Tournament]) =
    if effectiveGameVariant(prev) == GameVariant.ThreeKingdoms then !conditions.allowsBots
    else
      (sameClock(prev) && sameBots(prev)) ||
      !conditions.allowsBots || lila.core.game.isBotCompatible(clockConfig)

  private def sameClock(prev: Option[Tournament]) = prev.exists(_.clock == clockConfig)
  private def sameClockAndDuration(prev: Option[Tournament]) =
    sameClock(prev) && prev.exists(_.minutes == minutes)
  private def sameBots(prev: Option[Tournament]) =
    prev.exists(_.conditions.allowsBots == conditions.allowsBots)

  def realRated: Rated = Rated.No

  def realVariant = variant.flatMap(TournamentForm.guessVariant) | chess.variant.Standard

  def realPosition: Option[Fen.Standard] =
    position.ifTrue(realVariant.standard && realGameVariant.supportsCustomPosition).map(_.opening)

  def clockConfig = Clock.Config(LimitSeconds((clockTime * 60).toInt), clockIncrement)

  def speed = chess.Speed(clockConfig)

  def sufficientDuration(prev: Option[Tournament]) =
    sameClockAndDuration(prev) || estimateNumberOfGamesOneCanPlay(prev) >= 3
  def excessiveDuration(prev: Option[Tournament]) =
    sameClockAndDuration(prev) || estimateNumberOfGamesOneCanPlay(prev) <= 150

  def isPrivate = password.isDefined || conditions.teamMember.isDefined

  // prevent berserk tournament abuse with TC like 1+60,
  // where perf is Classical but berserked games are Hyperbullet.
  def timeControlPreventsBerserk =
    clockConfig.incrementSeconds.value > clockConfig.limitInMinutes * 2

  def isBerserkable = ~berserkable && !timeControlPreventsBerserk

  // update all fields and use default values for missing fields
  // meant for HTML form updates
  def updateAll(old: Tournament): Tournament =
    val newVariant = if old.canChangeGame && variant.isDefined then realVariant else old.variant
    val newGameVariant =
      if old.canChangeGame && gameVariant.isDefined then realGameVariant else old.gameVariant
    old
      .copy(
        name = name | old.name,
        ruleset = updatedRuleset(old),
        clock = if old.canChangeGame then clockConfig else old.clock,
        minutes = minutes,
        rated = realRated,
        variant = newVariant,
        gameVariant = newGameVariant,
        startsAt = startDate | old.startsAt,
        password = password,
        position = (newVariant.standard && newGameVariant.supportsCustomPosition).so:
          if old.canChangeGame then realPosition
          else old.position
        ,
        noBerserk = if old.isCreated then !isBerserkable else old.noBerserk,
        noStreak = if old.isCreated then !(~streakable) else old.noStreak,
        teamBattle = old.teamBattle,
        description = description,
        payouts = payouts,
        hasChat = hasChat | true
      )

  // update only fields that are specified
  // meant for API updates
  def updatePresent(old: Tournament): Tournament =
    val newVariant = if old.canChangeGame && variant.isDefined then realVariant else old.variant
    val newGameVariant =
      if old.canChangeGame && gameVariant.isDefined then realGameVariant else old.gameVariant
    old
      .copy(
        name = name | old.name,
        ruleset = updatedRuleset(old),
        clock = if old.canChangeGame then clockConfig else old.clock,
        minutes = minutes,
        rated = Rated.No,
        variant = newVariant,
        gameVariant = newGameVariant,
        startsAt = startDate | old.startsAt,
        password = password.fold(old.password)(_.nonEmptyOption),
        position = (newVariant.standard && newGameVariant.supportsCustomPosition).so {
          if position.isDefined && old.canChangeGame then realPosition
          else if old.canChangeGame && newGameVariant != old.gameVariant then none
          else old.position
        },
        noBerserk = if old.isCreated then berserkable.fold(old.noBerserk)(!_) || timeControlPreventsBerserk
        else old.noBerserk,
        noStreak = if old.isCreated then streakable.fold(old.noStreak)(!_) else old.noStreak,
        teamBattle = old.teamBattle,
        description = description.fold(old.description)(_.nonEmptyOption),
        payouts = payouts.fold(old.payouts)(_.nonEmptyOption),
        hasChat = hasChat | old.hasChat
      )

  def automodText = List(name, description).flatten.mkString("\n")

  private def estimateNumberOfGamesOneCanPlay(prev: Option[Tournament]): Double =
    (minutes.atMost(720) * 60) / estimatedGameSeconds(prev)

  // Players don't always use all their time (0.8).
  // add 15 seconds for pairing delay
  private def estimatedGameSeconds(prev: Option[Tournament]): Double = {
    (60 * clockTime + 30 * clockIncrement.value) * effectiveGameVariant(prev).playerCount * 0.8
  } + 15
