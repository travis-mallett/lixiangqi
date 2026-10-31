package lila.tv

import chess.{ ByColor, Color, Rated }
import org.apache.pekko.actor.{ ActorSystem, Props }
import org.apache.pekko.pattern.ask
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Sink
import org.apache.pekko.util.Timeout
import play.api.libs.json.Json

import lila.core.LightUser
import lila.core.game.{ Player, Source, TvSelect }
import lila.core.id.GamePlayerId
import lila.game.actorApi.MoveGameEvent
import lila.xiangqi.Xiangqi

class TvBroadcastTest extends munit.FunSuite:
  test("feeds replay their current snapshot, preserve moves during rendering, and ignore obsolete renders"):
    given system: ActorSystem = ActorSystem("tv-broadcast-test")
    given Executor = system.dispatcher
    given Materializer = Materializer(system)
    given Timeout = Timeout(5.seconds)
    // This test supplies rendered snapshots directly, without database or template dependencies.
    val proxy = java.lang.reflect.Proxy
      .newProxyInstance(
        classOf[lila.core.game.GameProxy].getClassLoader,
        Array(classOf[lila.core.game.GameProxy]),
        (_, _, _) => fuccess(None)
      )
      .asInstanceOf[lila.core.game.GameProxy]
    val actor =
      system.actorOf(Props(new TvBroadcast(LightUser.GetterSync(_ => None), Tv.Channel.Computer, proxy)))
    val game = lila.core.game
      .newGame(
        xiangqi = Xiangqi.Game.initial,
        players = ByColor(
          Player(GamePlayerId("red1"), Color.White, None),
          Player(GamePlayerId("blk1"), Color.Black, Some(1))
        ),
        rated = Rated.No,
        source = Source.Ai,
        pgnImport = None
      )
      .start
      .sloppy
      .copy(id = GameId("tvfeed01"))
    val moved = game.copy(movedAt = game.movedAt.plusSeconds(1))
    actor ! TvSelect(game.id, game.speed, Tv.Channel.Computer.key, Json.obj())
    actor ! MoveGameEvent(moved, "updated-fen", Xiangqi.Uci.unsafe("a1a2"))
    actor ! TvBroadcast.BroadcastGame(game, Json.obj(), Html("<a>first</a>"))
    val result = for
      source <- (actor ? TvBroadcast.Connect(false)).mapTo[TvBroadcast.SourceType]
      queue = source.runWith(Sink.queue())
      first <- queue.pull()
      // The pending move can follow the initial featured event, or already be in its snapshot.
      latest <-
        if first.exists(v => (v \ "d" \ "fen").asOpt[String].contains("updated-fen")) then fuccess(first)
        else queue.pull()
      _ = assertEquals(latest.map(v => (v \ "d" \ "fen").as[String]), Some("updated-fen"))
      _ = queue.cancel()
      compat <- (actor ? TvBroadcast.Connect(true)).mapTo[TvBroadcast.SourceType]
      compatQueue = compat.runWith(Sink.queue())
      html <- compatQueue.pull()
      fen <- compatQueue.pull()
      _ = assertEquals(html.map(v => (v \ "d" \ "html").as[String]), Some("<a>first</a>"))
      _ = assertEquals(fen.map(v => (v \ "d" \ "fen").as[String]), Some("updated-fen"))
      second = game.copy(id = GameId("tvfeed02"))
      _ = actor ! TvSelect(second.id, second.speed, Tv.Channel.Computer.key, Json.obj())
      _ = actor ! TvBroadcast.BroadcastGame(second, Json.obj(), Html("<a>second</a>"))
      _ = actor ! TvBroadcast.BroadcastGame(game, Json.obj(), Html("<a>obsolete</a>"))
      next <- compatQueue.pull()
      _ = assertEquals(next.map(v => (v \ "d" \ "id").as[String]), Some(second.id.value))
      _ = compatQueue.cancel()
      fresh <- (actor ? TvBroadcast.Connect(true)).mapTo[TvBroadcast.SourceType]
      freshQueue = fresh.runWith(Sink.queue())
      snapshot <- freshQueue.pull()
      _ = assertEquals(snapshot.map(v => (v \ "d" \ "html").as[String]), Some("<a>second</a>"))
    yield freshQueue.cancel()
    result.transformWith(outcome => system.terminate().map(_ => outcome.get))
