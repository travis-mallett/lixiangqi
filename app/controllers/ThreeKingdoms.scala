package controllers

import play.api.libs.json.*
import play.api.libs.EventSource
import play.api.mvc.*
import lila.app.{ *, given }
import lila.threeKingdoms.{ ClockConfig, Kingdom, KingdomChallenge }

final class ThreeKingdoms(env: Env) extends LilaController(env):
  private val feature = env.threeKingdoms
  private val actionLimit =
    lila.memo.RateLimit[UserId](120, 1.minute, "threeKingdoms.action")(using env.net.rateLimit)
  private val readLimit =
    lila.memo.RateLimit[lila.core.net.IpAddress](120, 1.minute, "threeKingdoms.read")(using env.net.rateLimit)
  private val streamLimit =
    lila.web.ConcurrencyLimit[String]("threeKingdoms.stream", 1.hour, maxConcurrency = 4)
  private val completionLimit =
    lila.memo
      .RateLimit[lila.core.net.IpAddress](3, 10.minutes, "threeKingdoms.completion")(using env.net.rateLimit)

  def page(mode: String) = Open:
    renderPage(if mode == "local" then views.round.threeKingdoms(mode) else views.threeKingdoms.page(mode))
      .map(Ok(_))

  def game(id: GameId) = Open:
    Found(feature.repo.byId(id)): game =>
      renderPage(views.round.threeKingdoms("game", Json.obj("game" -> feature.json(game, history = true))))
        .map(Ok(_))

  def roundBootstrap(id: GameId) = Open:
    Found(feature.repo.byId(id)): game =>
      fuccess(
        Ok(
          views.round.threeKingdomsBootstrap(id, Json.obj("game" -> feature.json(game, history = true)))
        ).noCache
      )

  def historyPage(username: UserStr) = Open:
    renderPage(views.threeKingdoms.page("history", Json.obj("user" -> username.value))).map(Ok(_))

  def challengePage(id: GameId) = AuthOrScoped(_.Mobile.Play) { ctx ?=> me ?=>
    feature.challenges
      .byId(id)
      .flatMap:
        case Some(challenge) if challenge.users.contains(me.userId) =>
          renderPage(views.threeKingdoms.page("challenge", Json.obj("challenge" -> challengeJson(challenge))))
            .map(Ok(_))
        case _ => fuccess(NotFound)
  }

  def state(id: GameId) = Open:
    readLimit(ctx.ip, rateLimited):
      Found(feature.repo.byId(id))(g =>
        fuccess(Ok(feature.json(g, history = getBool("history"))).withHeaders(CACHE_CONTROL -> "no-store"))
      )

  def record(id: GameId) = Open:
    readLimit(ctx.ip, rateLimited):
      Found(feature.repo.byId(id))(g =>
        fuccess(
          Ok(feature.json.record(g))
            .withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=three-kingdoms-${id.value}.json")
        )
      )

  def stream(id: GameId) = Open:
    readLimit(ctx.ip, rateLimited):
      fuccess(streamLimit(ctx.userId.fold(s"ip:${ctx.ip}")(id => s"user:${id.value}"))(feature.streams(id)):
        source =>
          Ok.chunked(source.map(Json.stringify).via(EventSource.flow))
            .as("text/event-stream")
            .noProxyBuffer
            .withHeaders(CACHE_CONTROL -> "no-store"))

  def history(user: Option[String], before: Option[String]) = Open:
    readLimit(ctx.ip, rateLimited):
      val cursor = before.traverse: value =>
        value.split(":", 2).toList match
          case time :: id :: Nil if id.matches("[A-Za-z0-9]{8}") =>
            time.toLongOption.filter(_ >= 0).map(at => java.time.Instant.ofEpochMilli(at) -> GameId(id))
          case _ => None
      cursor.fold(fuccess(BadRequest(jsonError("invalidCursor")))): at =>
        feature.repo
          .history(user.map(s => UserId(s.toLowerCase)), at)
          .map(games =>
            Ok(
              Json.obj(
                "games" -> games.map(feature.json(_)),
                "before" -> games.lastOption.map(g => s"${g.createdAt.toEpochMilli}:${g.id.value}")
              )
            )
          )

  def live = Open:
    readLimit(ctx.ip, rateLimited):
      fuccess(Ok(Json.obj("games" -> env.tv.threeKingdoms.live.map(feature.json(_)))))

  def exportHistory(user: UserStr) = Open:
    import env.system
    readLimit(ctx.ip, rateLimited):
      val source = feature.repo
        .exportUser(user.id, getTimestamp("since"), getTimestamp("until"))
        .throttle(20, 1.second)
        .map(g => Json.stringify(feature.json.record(g)) + "\n")
      fuccess(streamLimit(s"export:${ctx.ip}")(source): stream =>
        Ok.chunked(stream)
          .as("application/x-ndjson")
          .withHeaders(CONTENT_DISPOSITION -> s"attachment; filename=three-kingdoms-${user.id.value}.ndjson"))

  def tv = Open:
    readLimit(ctx.ip, rateLimited):
      env.tv.threeKingdoms.history.map: history =>
        Ok(
          Json.obj(
            "game" -> env.tv.threeKingdoms.game.map(feature.json(_, history = true)),
            "history" -> history.map(feature.json(_))
          )
        )

  def tvStream = Open:
    readLimit(ctx.ip, rateLimited):
      fuccess(
        streamLimit(ctx.userId.fold(s"ip:${ctx.ip}")(id => s"user:${id.value}"))(env.tv.threeKingdoms.source):
          source =>
            Ok.chunked(source.map(Json.stringify).via(EventSource.flow))
              .as("text/event-stream")
              .noProxyBuffer
              .withHeaders(CACHE_CONTROL -> "no-store")
      )

  def ongoing = AuthOrScoped(_.Mobile.Play) { _ ?=> me ?=>
    feature.repo.playing(me.userId).map(games => Ok(Json.obj("games" -> games.map(feature.json(_)))))
  }

  def bookmark(id: GameId) = AuthOrScoped(_.Mobile.Play) { _ ?=> me ?=>
    feature.repo
      .byId(id)
      .flatMap:
        case None => fuccess(NotFound)
        case Some(_) =>
          env.bookmark.api.exists(id, me.userId).map(value => Ok(Json.obj("bookmarked" -> value)))
  }

  def setBookmark(id: GameId) = AuthOrScopedBodyWithParser(parse.json)(_.Mobile.Play) { ctx ?=> me ?=>
    actionLimit(me.userId, rateLimited):
      (ctx.body.body \ "bookmarked").asOpt[Boolean].fold(fuccess(BadRequest)) { value =>
        feature.repo
          .byId(id)
          .flatMap:
            case None => fuccess(NotFound)
            case Some(_) =>
              env.bookmark.api
                .setForMultiPlayer(id, me.userId, value)
                .inject(Ok(Json.obj("bookmarked" -> value)))
      }
  }

  private def chatRoom(game: lila.threeKingdoms.KingdomGame)(using Context): (ChatId, Boolean) =
    val player = ctx.userId
      .flatMap(game.playerOf)
      .exists(k => game.position.finished || game.position.active.contains(k))
    ChatId(s"3k:${game.id.value}:${if player then "p" else "w"}") -> player

  def chat(id: GameId) = OpenOrScoped(_.Mobile.Play):
    readLimit(ctx.ip, rateLimited):
      Found(feature.repo.byId(id)): game =>
        val (room, player) = chatRoom(game)
        if ctx.kid.yes then
          fuccess(Ok(Json.obj("lines" -> Json.arr(), "writeable" -> false, "hidden" -> true)))
        else
          env.chat.api.userChat.cached
            .findMine(room)
            .map: chat =>
              env.chat.json.mobile(
                chat,
                writeable = ctx.isAuth && !chat.timeout &&
                  (!game.position.finished || game.movedAt.isAfter(nowInstant.minusSeconds(3600)))
              ) ++
                Json.obj("room" -> (if player then "player" else "spectator"))
            .map(Ok(_))

  def chatWrite(id: GameId) = AuthOrScopedBodyWithParser(parse.json)(_.Mobile.Play) { ctx ?=> me ?=>
    actionLimit(me.userId, rateLimited):
      if me.kid.yes then fuccess(Forbidden)
      else
        (ctx.body.body \ "text")
          .asOpt[String]
          .map(_.trim)
          .filter(s => s.nonEmpty && s.length <= 140)
          .fold(fuccess(BadRequest)) { text =>
            Found(feature.repo.byId(id)): game =>
              if game.position.finished && game.movedAt.isBefore(nowInstant.minusSeconds(3600)) then
                fuccess(Forbidden)
              else
                val (room, player) = chatRoom(game)
                env.chat.api
                  .write(
                    room,
                    me.userId,
                    text,
                    Option.when(!player)(lila.core.chat.PublicSource.ThreeKingdoms(id)),
                    _.threeKingdoms
                  )
                  .map: _ =>
                    env.chat.api.userChat.cached.invalidate(room)
                    Ok(Json.obj("ok" -> true))
          }
  }

  def act(id: GameId) = AuthOrScopedBodyWithParser(parse.json)(_.Mobile.Play) { ctx ?=> me ?=>
    actionLimit(me.userId, rateLimited):
      val fields = for
        revision <- (ctx.body.body \ "revision").asOpt[Int]
        action <- (ctx.body.body \ "action").asOpt[String].filter(_.length <= 80)
      yield revision -> action
      fields.fold(fuccess(BadRequest(jsonError("invalidRequest")))): (revision, action) =>
        feature.api
          .act(id, me.userId, revision, action)
          .map:
            case Right(game) => Ok(feature.json(game))
            case Left("staleRevision") => Conflict(jsonError("staleRevision"))
            case Left(error) => BadRequest(jsonError(error))
  }

  def computer = AuthOrScopedBodyWithParser(parse.json)(_.Mobile.Play) { ctx ?=> me ?=>
    limit.setupPost(ctx.ip, rateLimited):
      val request = for
        config <- configFrom(ctx.body.body)
        color <- Kingdom
          .fromKey((ctx.body.body \ "color").asOpt[String].getOrElse("red"))
          .toRight("invalidColor")
        level <- (ctx.body.body \ "level").asOpt[Int].filter(n => n >= 1 && n <= 5).toRight("invalidLevel")
      yield (config, color, level)
      request.fold(
        error => fuccess(BadRequest(jsonError(error))),
        (config, color, level) =>
          feature.maker
            .computer(me.userId, color, level, config)
            .map(g => Created(feature.json(g, history = true)))
      )
  }

  def completeLocal = OpenBodyOf(parse.json(512 * 1024)): ctx ?=>
    completionLimit(ctx.ip, rateLimited):
      val body = ctx.body.body
      val parsed = for
        id <- (body \ "id").asOpt[String].filter(_.matches("[A-Za-z0-9]{8}"))
        guest <- (body \ "guest").asOpt[String].flatMap(Kingdom.fromKey)
        level <- (body \ "level").asOpt[Int]
        elapsed <- (body \ "elapsed").asOpt[Long]
        config <- configFrom(body).toOption
        raw <- (body \ "events").asOpt[Vector[JsObject]].filter(_.size <= lila.threeKingdoms.Rules.maxPlies)
        events <- raw.traverse: e =>
          for
            action <- (e \ "action").asOpt[String].filter(_.length <= 80)
            actor <- (e \ "actor").asOpt[String].flatMap(Kingdom.fromKey)
            at <- (e \ "at").asOpt[Long]
            clocks <- (e \ "clocks").asOpt[Vector[Long]]
          yield lila.threeKingdoms.RecordedAction(action, actor, at, clocks)
        game <- lila.threeKingdoms.LocalCompletion
          .game(GameId(id), guest, level, config, events, nowMillis, elapsed)
          .toOption
      yield game
      parsed.fold(fuccess(BadRequest(jsonError("invalidRequest")))): game =>
        feature.maker.completeLocal(game).map(g => Created(feature.json(g, history = true)))

  def createChallenge = AuthOrScopedBodyWithParser(parse.json)(_.Mobile.Play) { ctx ?=> me ?=>
    limit.setupPost(ctx.ip, rateLimited):
      val request = for
        config <- configFrom(ctx.body.body)
        opponents <- (ctx.body.body \ "opponents")
          .asOpt[Vector[String]]
          .filter(v => v.size == 2 && v.forall(_.length <= 30))
          .toRight("chooseTwoDifferentPlayers")
      yield config -> opponents.map(s => UserId(s.trim.toLowerCase))
      request.fold(
        error => fuccess(BadRequest(jsonError(error))),
        (config, opponents) =>
          feature.challenges
            .create(me.value, opponents, config)
            .map:
              case Right(challenge) => Created(challengeJson(challenge))
              case Left(error) => BadRequest(jsonError(error))
      )
  }

  def challenges = AuthOrScoped(_.Mobile.Play) { _ ?=> me ?=>
    feature.challenges.forUser(me.userId).map(cs => Ok(Json.obj("challenges" -> cs.map(challengeJson))))
  }

  def challengeState(id: GameId) = AuthOrScoped(_.Mobile.Play) { _ ?=> me ?=>
    feature.challenges
      .byId(id)
      .map:
        case Some(c) if c.users.contains(me.userId) => Ok(challengeJson(c))
        case _ => NotFound
  }

  def answer(id: GameId, accept: Boolean) = AuthOrScopedBody(_.Mobile.Play) { _ ?=> me ?=>
    actionLimit(me.userId, rateLimited):
      feature.challenges
        .answer(id, me.userId, accept)
        .map:
          case Right(c) => Ok(challengeJson(c))
          case Left(error) => BadRequest(jsonError(error))
  }

  def poolJoin = AuthOrScopedBody(_.Mobile.Play) { _ ?=> me ?=>
    actionLimit(me.userId, rateLimited):
      env.msg.unreadCount
        .hasLichessMsg(me.userId)
        .zip(env.game.gameRepo.playingRealtimeNoAi(me.value))
        .flatMap:
          case (true, _) => fuccess(Forbidden(jsonError("readModeratorMessage")))
          case (_, games) if games.nonEmpty => fuccess(Conflict(jsonError("ongoingGame")))
          case _ => feature.pool.join(me.value).map(Ok(_))
  }

  def poolLeave = AuthOrScopedBody(_.Mobile.Play) { _ ?=> me ?=>
    feature.pool.leave(me.userId).map(Ok(_))
  }

  private def configFrom(body: JsValue): Either[String, ClockConfig] =
    scala.util
      .Try(
        ClockConfig(
          (body \ "initialSeconds").asOpt[Int].getOrElse(900),
          (body \ "moveSeconds").asOpt[Int].getOrElse(60)
        )
      )
      .toEither
      .left
      .map(_ => "invalidClock")

  private def challengeJson(c: KingdomChallenge): JsObject = Json.obj(
    "id" -> c.id.value,
    "creator" -> c.creator.value,
    "users" -> c.users.map(_.value),
    "accepted" -> c.accepted.toVector.map(_.value),
    "expiresAt" -> c.expiresAt.toEpochMilli,
    "status" -> c.status,
    "initialSeconds" -> c.config.initialSeconds,
    "moveSeconds" -> c.config.moveSeconds
  )
