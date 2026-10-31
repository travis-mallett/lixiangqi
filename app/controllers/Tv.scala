package controllers

import play.api.http.ContentTypes
import play.api.libs.EventSource
import play.api.libs.json.*
import play.api.mvc.Result

import lila.app.{ *, given }
import lila.common.Json.given
import lila.tv.Tv.Channel

final class Tv(env: Env, apiC: => Api, gameC: => Game) extends LilaController(env):

  def index = Open(serveIndex)
  def indexLang = LangPage(routes.Tv.index)(serveIndex)

  private def serveIndex(using Context) = serveChannel(Channel.Xiangqi.key)

  def onChannel(chanKey: String) = Open(serveChannel(chanKey))

  private def serveChannel(chanKey: String)(using Context) =
    if chanKey == Channel.ThreeKingdoms.key then
      env.tv.tv.getChampions.flatMap(champions => Ok.page(views.threeKingdoms.television("tv", champions)))
    else Channel.byKey.get(chanKey).so(lichessTv)

  def sides(gameId: GameId, color: Color) = Open:
    Found(env.round.proxyRepo.pov(gameId, color)): pov =>
      env.game.crosstableApi.withMatchup(pov.game).flatMap { ct =>
        Ok.snip(views.tv.ui.side.sides(pov, ct))
      }

  def channels = apiC.ApiRequest:
    env.tv.tv.getChampions
      .map:
        _.channels.map { (chan, champ) => chan.key -> champ }
      .map: channels =>
        Json.toJson(channels).as[JsObject] ++ env.tv.threeKingdoms.game.fold(Json.obj()): game =>
          Json.obj(
            "threeKingdoms" -> Json.obj(
              "gameId" -> game.id.value,
              "players" -> (env.threeKingdoms.json(game) \ "seats").as[JsValue]
            )
          )
      .dmap(Api.ApiResult.Data.apply)

  private def lichessTv(channel: Channel)(using Context) =
    env.tv.tv
      .getGameAndHistory(channel)
      .flatMap:
        case None =>
          env.tv.tv.getChampions.flatMap: champions =>
            negotiateApi(
              html = Ok.page(views.tv.ui.games(channel, Nil, champions, "/tv")).map(_.noCache),
              api = _ => notFound
            )
        case Some((game, history)) => showTv(channel, game, history)

  private def showTv(channel: Channel, game: lila.core.game.Game, history: List[Pov])(using Context) =
    val flip = getBool("flip")
    val natural = Pov.naturalOrientation(game)
    val pov = if flip then !natural else natural
    val onTv = lila.round.OnTv.Lichess(channel.key, flip)
    env.user.api
      .gamePlayers(game.userIdPair, game.perfKey)
      .flatMap: users =>
        gameC.preloadUsers(users)
        negotiateApi(
          html = for
            tour <- env.tournament.api.gameView.watcher(pov.game)
            data <- env.api.roundApi.watcher(pov, users, tour, tv = onTv.some)
            cross <- env.game.crosstableApi.withMatchup(game)
            champs <- env.tv.tv.getChampions
            page <- renderPage(views.tv.index(channel, champs, pov, data, cross, history))
          yield Ok(page).noCache,
          api = _ => env.api.roundApi.watcher(pov, users, none, tv = onTv.some).dmap { Ok(_) }
        )

  def games = gamesChannel(Channel.Xiangqi.key)

  def gamesChannel(chanKey: String) = Open:
    if chanKey == Channel.ThreeKingdoms.key then
      env.tv.tv.getChampions.flatMap(champions => Ok.page(views.threeKingdoms.television("live", champions)))
    else
      Channel.byKey.get(chanKey).so { channel =>
        for
          champs <- env.tv.tv.getChampions
          games <- env.tv.tv.getGames(channel, 15)
          recent <- env.tv.tv.getRecentGames(channel)
          live = games.filter(g => g.isBeingPlayed && channel.isFresh(g))
          past = recent.filterNot(g => live.exists(_.id == g.id))
          result <- Ok
            .page(
              views.tv.ui.games(
                channel,
                live.map(Pov.naturalOrientation),
                champs,
                recent = past.map(Pov.naturalOrientation)
              )
            )
            .map(_.noCache)
        yield result
      }

  def gameChannelReplacement(chanKey: String, gameId: GameId, exclude: List[GameId]) = Open:
    val gameFu = Channel.byKey.get(chanKey).so { channel =>
      env.tv.tv.getReplacementGame(channel, gameId, exclude)
    }
    Found(gameFu): game =>
      JsonOk:
        Json.obj(
          "id" -> game.id,
          "html" -> views.game.mini(Pov.naturalOrientation(game)).toString
        )

  def apiGamesChannel(chanKey: String) = Anon:
    if chanKey == Channel.ThreeKingdoms.key then
      fuccess(
        jsToNdJson(
          org.apache.pekko.stream.scaladsl
            .Source(env.tv.threeKingdoms.live.map(env.threeKingdoms.json.record))
        )
      )
    else
      Channel.byKey.get(chanKey).so { channel =>
        env.tv.tv.getGameIds(channel, getInt("nb").fold(10)(_.atMost(30).atLeast(1))).map { gameIds =>
          val config =
            lila.api.GameApiV2.ByIdsConfig(
              ids = gameIds,
              format = lila.api.GameApiV2.Format.byRequest,
              flags = gameC.requestPgnFlags(extended = false).copy(delayMoves = false),
              perSecond = MaxPerSecond(30)
            )
          Ok.chunked(env.api.gameApiV2.exportByIds(config)).as(gameC.gameContentType(config)).noProxyBuffer
        }
      }

  def feedDefault = Anon:
    serveFeedFromChannel(Channel.Xiangqi)

  def feed(chanKey: String) = Anon:
    if chanKey == Channel.ThreeKingdoms.key then fuccess(jsToNdJson(env.tv.threeKingdoms.source))
    else Channel.byKey.get(chanKey).so(serveFeedFromChannel)

  private def serveFeedFromChannel(channel: Channel)(using Context): Fu[Result] =
    val bc = getBool("bc")
    env.tv
      .channelSource(channel, bc)
      .so:
        _.map: source =>
          if bc then
            Ok.chunked(source.via(EventSource.flow).log("Tv.feed"))
              .as(ContentTypes.EVENT_STREAM)
              .noProxyBuffer
          else jsToNdJson(source)

  def frameDefault = Anon:
    serveFrameFromChannel(Channel.Xiangqi)

  def frame(chanKey: String) = Anon:
    if chanKey == Channel.ThreeKingdoms.key then
      InEmbedContext:
        Ok.snip(views.threeKingdoms.embed).map(_.noCache)
    else Channel.byKey.get(chanKey).so(serveFrameFromChannel)

  private def serveFrameFromChannel(channel: Channel)(using Context) =
    env.tv.tv
      .getGame(channel)
      .flatMap: game =>
        InEmbedContext:
          Ok.snip(views.tv.embed(game.map(Pov.naturalOrientation), channel.key.some)).map(_.noCache)
