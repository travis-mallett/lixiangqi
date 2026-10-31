package controllers

import play.api.libs.json.*
import play.api.mvc.*

import lila.app.{ *, given }
import lila.common.HTTPRequest
import lila.common.Json.given
import lila.core.id.GameAnyId
import lila.core.round.RoundBus
import lila.game.GameExt.playerCanOfferDraw
import lila.xiangqi.Xiangqi

/** Native human play uses the same lobby, rules, clocks and round actor as the website. */
final class MobilePlay(env: Env) extends LilaController(env):

  private val requests = lila.memo.RateLimit[String](
    credits = 240,
    duration = 1.minute,
    key = "mobile.play.request"
  )(using env.net.rateLimit)
  private val streams = lila.web.ConcurrencyLimit[String](
    key = "mobile.play.stream",
    ttl = 1.hour,
    maxConcurrency = 3
  )
  private def clientKey(using ctx: Context) = ctx.userId.fold(s"ip:${ctx.ip}")(id => s"user:$id")

  def home = AnonOrScoped(_.Mobile.Play): ctx ?=>
    for
      me <- ctx.me.traverse(me => env.user.api.withPerfs(me.value))
      lobby <- env.api.lobbyApi.get(using me)
    yield
      val socketDomain = env.net.socketDomains.headOption.getOrElse(ctx.req.host)
      val scheme = if env.net.baseUrl.value.startsWith("https:") then "wss" else "ws"
      env.security.lilaCookie.ensure(ctx.req)(
        Ok(
          lobby._1 ++ Json
            .obj(
              "pools" -> lila.pool.PoolList.homepageJson,
              "quickPools" -> lila.pool.PoolList.json,
              "socketUrl" -> s"$scheme://$socketDomain/lobby/socket/v5"
            )
            .add(
              "socketToken" -> ctx.me
                .flatMap(_ => HTTPRequest.bearer(ctx.req))
                .map(_.value)
            )
        ).withHeaders(CACHE_CONTROL -> "no-store")
      )

  def gameStream(id: GameAnyId) = AnonOrScoped(_.Mobile.Play): ctx ?=>
    withPov(id): pov =>
      env.game.gameRepo
        .withInitialFen(pov.game)
        .map: game =>
          streams(clientKey)(
            env.bot.gameStateStream.mobile(game, pov.color, ctx.me, mobileState(_, pov.color))
          )(jsOptToNdJson)

  def cancelSeek(id: String) = Scoped(_.Mobile.Play): _ ?=>
    me ?=> env.lobby.cancelSeek(id, me.userId).inject(NoContent)

  def move(id: GameAnyId, uci: String) = AnonOrScopedBody(parse.anyContent)(_.Mobile.Play): ctx ?=>
    withPov(id): pov =>
      val rawMillis = ctx.body.body.asFormUrlEncoded.flatMap(_.get("millis").flatMap(_.headOption))
      val millis = rawMillis.flatMap(_.toLongOption.filter(ms => ms >= 0 && ms <= Int.MaxValue))
      val rawLag = ctx.body.body.asFormUrlEncoded.flatMap(_.get("lag").flatMap(_.headOption))
      val lag = rawLag.flatMap(_.toLongOption.filter(ms => ms >= 0 && ms <= Int.MaxValue))
      if (rawMillis.isDefined && millis.isEmpty) || (rawLag.isDefined && lag.isEmpty) then
        JsonBadRequest("Invalid move time")
      else
        Xiangqi.Uci.from(uci) match
          case Left(error) => JsonBadRequest(error)
          case Right(_) if !pov.isMyTurn => JsonBadRequest("Not your turn, or game already over")
          case Right(move) =>
            env.round
              .mobileMove(
                pov,
                move,
                chess.MoveMetrics(
                  clientLag = lag.filter(_ => millis.isEmpty).map(chess.Centis.ofMillis),
                  clientMoveTime = millis.map(chess.Centis.ofMillis)
                )
              )
              .inject(jsonOkResult)
              .recover:
                case error: lila.core.round.BenignError => BadRequest(jsonError(error.getMessage))

  def command(id: GameAnyId, cmd: String) = AnonOrScopedBody(parse.anyContent)(_.Mobile.Play): ctx ?=>
    withPov(id): pov =>
      def send(message: Matchable) =
        env.round.roundApi.tell(pov.gameId, message)
        fuccess(jsonOkResult)
      cmd match
        case "abort" => result(env.bot.player.abort(pov))
        case "resign" => result(env.bot.player.resign(pov))
        case "draw/true" => send(RoundBus.Draw(pov.playerId, true))
        case "draw/false" => send(RoundBus.Draw(pov.playerId, false))
        case "draw-claim" => send(lila.core.round.DrawClaim(pov.playerId))
        case "takeback/true" => send(RoundBus.Takeback(pov.playerId, true))
        case "takeback/false" => send(RoundBus.Takeback(pov.playerId, false))
        case "rematch/true" => send(RoundBus.Rematch(pov.playerId, true))
        case "rematch/false" => send(RoundBus.Rematch(pov.playerId, false))
        case "moretime" => send(lila.core.round.Moretime(pov.playerId))
        case "berserk" =>
          pov.game.tournamentId
            .so(env.tournament.cached.tourCache.byId)
            .map:
              case Some(tour)
                  if tour.isStarted && tour.berserkable && pov.game.berserkable && ctx.userId.isDefined =>
                lila.common.Bus.pub(lila.core.round.Berserk(pov.gameId, ctx.userId.get))
                jsonOkResult
              case _ => BadRequest(jsonError("Berserk is unavailable"))
        case "claim-victory" => result(env.bot.player.claimVictory(pov))
        case "claim-draw" => result(env.bot.player.claimDraw(pov))
        case _ => notFoundJson("No such command")

  private def result(action: Funit) = action
    .inject(jsonOkResult)
    .recover:
      case error: lila.core.round.BenignError => BadRequest(jsonError(error.getMessage))

  private def withPov(id: GameAnyId)(f: Pov => Fu[Result])(using ctx: Context): Fu[Result] =
    requests(clientKey, rateLimited):
      NoBot:
        env.round.proxyRepo
          .game(id.gameId)
          .flatMap:
            case None => notFoundJson("No such game")
            case Some(game) =>
              val pov = lila.core.game.Pov.forPlayer(game, id, ctx.userId)
              pov.fold(notFoundJson("Not your game").toFuccess)(f)

  private def mobileState(game: GameModel, color: Color): Fu[JsObject] =
    val pov = Pov(game, color)
    val (presence, presenceGroup) = lila.core.game.GamePresence(game, env.pool.api)
    for
      (takeback, moretime) <- env.round.mobileGameControls(pov)
      rematch <- env.game.rematches.getAcceptedId(game.id).traverse(env.round.proxyRepo.game)
      tour <- game.tournamentId.so(env.tournament.cached.tourCache.byId)
    yield Json
      .obj(
        "presence" -> presence,
        "presenceGroup" -> presenceGroup,
        "tournamentId" -> game.tournamentId,
        "berserkable" -> (tour
          .exists(t => t.isStarted && t.berserkable) && game.berserkable && !pov.player.berserk),
        "takebackable" -> takeback,
        "kidsBotAssisted" -> game.metadata.kidsBotAssisted,
        "kidsBotProfile" -> game.metadata.kidsBotProfile,
        "moretimeable" -> moretime,
        "drawable" -> (game.playerCanOfferDraw(color) || pov.opponent.isOfferingDraw),
        "resignable" -> game.resignable,
        "claimableDraw" -> (game.drawable && game.position.optionalEnd.ended &&
          game.position.gameResult == Xiangqi.Result.Draw),
        "notation" -> game.xiangqi.wxf,
        "rematchable" -> (game.finishedOrAborted && game.nonMandatory && !game
          .hasRule(_.noRematch) && !game.boosted && !(game.aborted && game.ranked &&
          game.source
            .exists(source => source == lila.core.game.Source.Lobby || source == lila.core.game.Source.Pool)))
      )
      .add(
        "poolId" -> lila.pool.PoolList.all
          .find(pool =>
            game.source.contains(lila.core.game.Source.Pool) &&
              game.rankTrack == pool.rankTrack &&
              game.clockConfig.contains(pool.clock) && game.moveTimeLimit == pool.moveTimeLimit
          )
          .map(_.id)
      )
      .add("rematch" -> rematch.flatten.map: next =>
        pov.player.userId
          .flatMap(Pov(next, _))
          .fold(
            // Anonymous rematches reverse the players just as the website does.
            next.fullIdOf(!color).value
          )(_.gameId.value))
