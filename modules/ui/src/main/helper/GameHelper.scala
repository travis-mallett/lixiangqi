package lila.ui

import chess.{ Clock, Color, Outcome }

import lila.core.LightUser
import lila.core.game.{ Game, LightPlayer, MoveTimeLimit, Namer, Player }
import lila.core.rank.RankDiff
import lila.core.rank.RankCode.value
import lila.core.rank.RankDiff.value
import lila.ui.ScalatagsTemplate.{ *, given }

trait GameHelper:
  self: I18nHelper & StringHelper & AssetHelper & UserHelper =>

  protected val namer: Namer

  def titleGame(g: Game)(using Translate) =
    val speedName = chess.Speed(g.clock.map(_.config)).name
    val speed = g.clock
      .flatMap(clock => g.moveTimeLimit.map(clock.config -> _))
      .fold(speedName): (clock, limit) =>
        s"$speedName (${clock.show} · ${shortMoveTimeLimitName(limit)})"
    val variant = g.variant.exotic.so(s" ${g.variant.name}")
    s"$speed$variant Xiangqi • ${playerText(g.whitePlayer)} vs ${playerText(g.blackPlayer)}"

  def shortClockName(clock: Option[Clock.Config])(using t: Translate): Frag =
    clock.fold[Frag](trans.site.unlimited())(shortClockName)

  def shortClockName(clock: Clock.Config): Frag = raw(clock.show)

  def moveTimeLimitName(limit: MoveTimeLimit)(using Translate): String =
    limit.first.fold(trans.site.secondsPerMove.txt(limit.seconds)): first =>
      trans.site.moveTimeLimitDescription.txt(first.seconds, first.moves, limit.seconds)

  def shortMoveTimeLimitName(limit: MoveTimeLimit)(using Translate): String =
    limit.first.fold(trans.site.secondsPerMove.txt(limit.seconds)): first =>
      trans.site.moveTimeLimitShort.txt(first.seconds, first.moves, limit.seconds)

  def shortClockName(clock: Clock.Config, moveTimeLimit: Option[MoveTimeLimit])(using Translate): Frag =
    moveTimeLimit.fold(shortClockName(clock)): limit =>
      abbr(title := moveTimeLimitName(limit))(s"${clock.show} · ${shortMoveTimeLimitName(limit)}")

  def shortClockName(game: Game)(using Translate): Frag =
    game.correspondenceClock
      .map(c => trans.site.nbDays(c.daysPerTurn))
      .orElse(game.clock.map(_.config).map(shortClockName(_, game.moveTimeLimit)))
      .getOrElse(trans.site.unlimited())

  def rankedName(ranked: Boolean)(using Translate): String =
    if ranked
    then trans.site.ranked.txt()
    else trans.site.casual.txt()

  def playerUsername(
      player: LightPlayer,
      user: Option[LightUser],
      withRating: Boolean = true,
      withTitle: Boolean = true
  )(using Translate): Frag =
    player.aiLevel.fold[Frag](
      user
        .fold[Frag](trans.site.anonymous.txt()): user =>
          frag(
            titleTag(withTitle.so(user.title)),
            user.name,
            user.flair.map(userFlair),
            withRating.option(
              player.rank.flatMap(_.publicCode).map(rank => span(cls := "rank")(" (", rank.value, ")"))
            )
          )
    ): level =>
      frag(aiName(level))

  def playerText(player: Player, withRating: Boolean = false): String =
    namer.playerTextBlocking(player, withRating)(using lightUserSync)

  def gameVsText(game: Game, withRatings: Boolean = false): String =
    namer.gameVsTextBlocking(game, withRatings)(using lightUserSync)

  val berserkIconSpan = iconTag(lila.ui.Icon.Berserk)

  def playerLink(
      player: Player,
      cssClass: Option[String] = None,
      withOnline: Boolean = true,
      withRating: Boolean = true,
      withDiff: Boolean = true,
      engine: Boolean = false,
      withBerserk: Boolean = false,
      mod: Boolean = false,
      link: Boolean = true
  )(using ctx: Context): Frag =
    val statusIcon = (withBerserk && player.berserk).option(berserkIconSpan)
    player.userId.flatMap(lightUserSync) match
      case None =>
        val klass = cssClass.so(" " + _)
        span(cls := s"user-link$klass")(
          (player.aiLevel, player.name) match
            case (Some(level), _) => aiNameFrag(level)
            case (_, Some(name)) => name
            case _ => trans.site.anonymous()
          ,
          player.rank.filter(_ => withRating).flatMap(_.publicCode).map { rank => s" (${rank.value})" },
          statusIcon
        )
      case Some(user) =>
        frag(
          (if link then a else span) (
            cls := userClass(user.id, cssClass, withOnline),
            (if link then href
             else dataHref) := s"${routes.User.show(user.name)}${if mod then "?mod" else ""}"
          )(
            withOnline.option(frag(lineIcon(user), " ")),
            playerUsername(
              player.light,
              user.some,
              withRating = withRating
            ),
            (player.rank.flatMap(_.diff).ifTrue(withDiff)).map { d =>
              frag(" ", showRankDiff(d))
            },
            engine.option(span(cls := "tos_violation", title := trans.site.thisAccountViolatedTos.txt()))
          ),
          statusIcon
        )

  private def showRankDiff(diff: RankDiff): Frag =
    if diff.value == 0 then span("±0")
    else if diff.value > 0 then goodTag(s"+${diff.value}")
    else badTag(s"−${-diff.value}")

  def gameResult(game: Game) =
    Outcome.showResult(game.finished.option(Outcome(game.winnerColor)))

  def gameLink(
      game: Game,
      color: Color,
      ownerLink: Boolean = false,
      tv: Boolean = false
  )(using ctx: Context): String = {
    val owner = ownerLink.so(ctx.me.flatMap(game.player))
    if tv then routes.Tv.index
    else
      owner.fold(routes.Round.watcher(game.id, color)): o =>
        routes.Round.player(game.fullIdOf(o.color))
  }.toString

  def gameLink(pov: Pov)(using Context): String = gameLink(pov.game, pov.color)

  def aiName(level: Int)(using Translate): String =
    trans.site.aiNameLevelAiLevel.txt("Pikafish", level)

  def aiNameFrag(level: Int)(using Translate) =
    raw(aiName(level).replace(" ", "&nbsp;"))

  def variantLink(
      variant: chess.variant.Variant,
      pk: PerfKey,
      initialFen: Option[chess.format.Fen.Full] = None,
      shortName: Boolean = false
  )(using Translate): Frag =

    def link(href: String, title: String, name: String) = a(
      cls := "variant-link",
      st.href := href,
      targetBlank,
      st.title := title
    )(name)

    if variant.exotic then
      link(
        href = variant match
          case chess.variant.FromPosition =>
            s"""${routes.Editor.index}?fen=${initialFen.so(_.value.replace(' ', '_'))}"""
          case v => routes.Cms.variant(v.key).url
        ,
        title = variant.variantTitleTrans.txt(),
        name = (if shortName && variant == chess.variant.KingOfTheHill then variant.shortName
                else variant.variantTrans.txt()).toUpperCase
      )
    else if variant.standard then span(title := variant.variantTitleTrans.txt())(variant.variantTrans.txt())
    else if pk == PerfKey.correspondence then
      link(
        href = s"${routes.Main.faq}#correspondence",
        title = PerfKey.correspondence.perfDesc.txt(),
        name = PerfKey.correspondence.perfTrans
      )
    else span(title := pk.perfDesc.txt())(pk.perfTrans)

  def perfLink(pk: PerfKey)(using Translate): Frag =
    variantLink(chess.variant.Standard, pk)
