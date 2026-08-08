package lila.round

import chess.{ Rated, ByColor, Clock, Color as ChessColor }
import scalalib.cache.ExpireSetMemo

import lila.common.Bus
import lila.core.game.{ GameRepo, IdGenerator }
import lila.core.i18n.{ I18nKey as trans, Translator, defaultLang }
import lila.core.user.{ GameUsers, UserApi }
import lila.game.{ AnonCookie, Event, Rematches, rematchAlternatesColor }
import lila.xiangqi.Xiangqi

final private class Rematcher(
    gameRepo: GameRepo,
    userApi: UserApi,
    messenger: Messenger,
    onStart: lila.core.game.OnStart,
    rematches: Rematches
)(using Executor, Translator, lila.core.config.RateLimit)(using idGenerator: IdGenerator):

  private given play.api.i18n.Lang = defaultLang

  private val declined = ExpireSetMemo[GameFullId](1.minute)

  private val rateLimit = lila.memo.RateLimit[GameFullId](
    credits = 2,
    duration = 1.minute,
    key = "round.rematch",
    log = false
  )

  export rematches.isOffering

  def apply(pov: Pov, confirm: Boolean): Fu[Events] =
    if confirm then yes(pov) else no(pov)

  private def couldRematch(g: Game): Boolean =
    g.finishedOrAborted &&
      g.nonMandatory &&
      !g.hasRule(_.noRematch) &&
      !g.boosted &&
      !(g.hasAi && g.fromPosition && g.clock.exists(_.config.limitSeconds < 60))

  def yes(pov: Pov): Fu[Events] =
    pov match
      case Pov(game, color) if couldRematch(game) =>
        if isOffering(!pov.ref) || game.opponent(color).isAi
        then rematches.getAcceptedId(game.id).fold(rematchJoin(pov))(rematchExists(pov))
        else if !declined.get(pov.flip.fullId) && rateLimit.zero(pov.fullId)(true)
        then rematchCreate(pov)
        else fuccess(List(Event.RematchOffer(by = none)))
      case _ => fuccess(List(Event.ReloadOwner))

  def no(pov: Pov): Fu[Events] =
    if isOffering(pov.ref) then
      pov.opponent.userId.foreach: forId =>
        Bus.publishDyn(lila.core.round.RematchCancel(pov.gameId), s"rematchFor:$forId")
      messenger.volatile(pov.game, trans.site.rematchOfferCanceled.txt())
    else if isOffering(!pov.ref) then
      declined.put(pov.fullId)
      messenger.volatile(pov.game, trans.site.rematchOfferDeclined.txt())
    rematches.drop(pov.gameId)
    fuccess(List(Event.RematchOffer(by = none)))

  private def rematchExists(pov: Pov)(nextId: GameId): Fu[Events] =
    gameRepo
      .game(nextId)
      .flatMap:
        _.fold(rematchJoin(pov))(g => fuccess(redirectEvents(g)))

  private def rematchCreate(pov: Pov): Fu[Events] =
    rematches.offer(pov.ref).map { _ =>
      messenger.volatile(pov.game, trans.site.rematchOfferSent.txt())
      pov.opponent.userId.foreach: forId =>
        Bus.publishDyn(lila.core.round.RematchOffer(pov.gameId), s"rematchFor:$forId")
      List(Event.RematchOffer(by = pov.color.some))
    }

  private def rematchJoin(pov: Pov): Fu[Events] =

    def createGame(withId: Option[GameId]) = for
      nextGame <- returnGame(pov, withId).map(_.start)
      _ = rematches.accept(pov.gameId, nextGame.id)
      _ <- gameRepo.insertDenormalized(nextGame)
    yield
      messenger.volatile(pov.game, trans.site.rematchOfferAccepted.txt())
      onStart.exec(nextGame.id)
      incUserColors(nextGame)
      redirectEvents(nextGame)

    rematches.get(pov.gameId) match
      case None => createGame(none)
      case Some(Rematches.NextGame.Accepted(id)) => gameRepo.game(id).mapz(redirectEvents)
      case Some(Rematches.NextGame.Offered(_, id)) => createGame(id.some)

  private def returnGame(pov: Pov, withId: Option[GameId]): Fu[Game] =
    for
      users <- userApi.gamePlayersAny(pov.game.userIdPair, pov.game.perfKey)
      newXiangqi = Rematcher.reset(pov.game.xiangqi)
      sloppy = lila.core.game.newGame(
        xiangqi = newXiangqi,
        clock = pov.game.clock.map(c => Clock(c.config)),
        moveTimeLimit = pov.game.moveTimeLimit,
        startedAtPly = chess.Ply(newXiangqi.states.head.ply),
        players = ByColor(returnPlayer(pov.game, _, users)),
        rated = if users.exists(_.exists(_.user.lame)) then Rated.No else pov.game.rated,
        source = pov.game.source | lila.core.game.Source.Lobby,
        daysPerTurn = pov.game.daysPerTurn,
        pgnImport = None,
        variant = pov.game.variant
      )
      game <- withId.fold(idGenerator.withUniqueId(sloppy)): id =>
        fuccess(sloppy.withId(id))
    yield game

  private def incUserColors(game: Game): Unit =
    if game.lobbyOrPool
    then
      game.userIds match
        case List(u1, u2) =>
          userApi.incColor(u1, game.whitePlayer.color)
          userApi.incColor(u2, game.blackPlayer.color)
        case _ => ()

  private def returnPlayer(game: Game, color: ChessColor, users: GameUsers): lila.core.game.Player =
    val fromColor = if rematchAlternatesColor(game, users.mapList(_.map(_.user))) then !color else color
    game.opponent(color).aiLevel match
      case Some(ai) => lila.game.Player.makeAnon(color, ai.some)
      case None => lila.game.Player.make(color, users(fromColor))

  def redirectEvents(game: Game): Events =
    val ownerRedirects = ByColor: color =>
      Event.RedirectOwner(!color, game.fullIdOf(color), AnonCookie.json(game.pov(color)))
    val spectatorRedirect = Event.RematchTaken(game.id)
    spectatorRedirect :: ownerRedirects.toList

private[round] object Rematcher:

  def reset(game: Xiangqi.Game): Xiangqi.Game =
    Xiangqi.Game(
      initialFen = game.initialFen,
      moves = Vector.empty,
      wxf = Vector.empty,
      states = Vector(game.states.head)
    )
