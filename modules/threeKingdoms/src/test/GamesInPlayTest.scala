package lila.threeKingdoms

import scala.concurrent.Await
import chess.Status
import reactivemongo.api.AsyncDriver
import lila.db.dsl.{ *, given }

class GamesInPlayTest extends munit.FunSuite:
  sys.env
    .get("LIXIANGQI_IN_PLAY_TEST_URI")
    .foreach: uri =>
      test("the lobby counts started games across both stores and requires a player on clockless boards"):
        given Executor = scala.concurrent.ExecutionContext.global
        def await[A](f: Fu[A]): A = Await.result(f, 20.seconds)
        val driver = new AsyncDriver()
        val db =
          await(await(driver.connect(uri)).database("in_play_test_" + java.util.UUID.randomUUID().toString))
        val native = new lila.game.GameRepo(db.collection("game5"))
        val kingdoms = GameRepo(db.collection("three_kingdoms_game"))
        val started = $doc("s" -> Status.Started.id)
        val clocked = started ++ $doc("c" -> true)
        val postal = GameId("postal01")
        val unlimited = GameId("unlimit1")
        val alice = UserId("alice")
        val bob = UserId("bob")
        try
          val variants = List("xiangqi", "jieqi", "minixiangqi", "manchu", "banqi")
          for variant <- variants do
            await(
              native.coll.insert.one(
                $id(variant) ++ clocked ++ $doc("xg" -> $doc("states" -> List($doc("variant" -> variant))))
              )
            )
          for (id, fields) <- List(
              postal.value -> (started ++ $doc("cd" -> 3)),
              unlimited.value -> started,
              "paused" -> (clocked ++ $doc("mp" -> true)),
              "import" -> (clocked ++ $doc("so" -> lila.core.game.Source.Import.id)),
              "relay" -> (clocked ++ $doc("so" -> lila.core.game.Source.ImportLive.id)),
              "created" -> $doc("s" -> Status.Created.id, "c" -> true),
              "finished" -> $doc("s" -> Status.Mate.id, "c" -> true),
              "aborted" -> $doc("s" -> Status.Aborted.id, "c" -> true)
            )
          do await(native.coll.insert.one($id(id) ++ fields))
          def nativeCount(ids: GameId*) = await(native.countInPlay(ids.toSet))
          assertEquals(nativeCount(), variants.size)
          assertEquals(
            nativeCount(postal, postal, unlimited, GameId("xiangqi"), GameId("aborted")),
            variants.size + 2
          )
          await(native.coll.update.one($id(postal), $set("s" -> Status.Resign.id)))
          assertEquals(nativeCount(postal), variants.size)

          val now = nowInstant
          val seats = Vector(alice, bob, UserId("charlie")).map(u => Seat(Some(u), None, None))
          val realtime = KingdomGame(
            GameId("three001"),
            seats,
            Position.initial,
            Position.initial,
            ClockState.start(ClockConfig(), now.toEpochMilli),
            now,
            now
          )
          def timed(id: GameId, config: ClockConfig) =
            realtime.copy(id = id, clock = ClockState.start(config, now.toEpochMilli))
          val correspondence = timed(postal, ClockConfig(0, 0, days = Some(3)))
          val afterElimination = correspondence.resign(alice, now.toEpochMilli).toOption.get
          List(
            realtime,
            timed(GameId("incr0001"), ClockConfig(0, 0, incrementSeconds = Some(2))),
            correspondence,
            timed(unlimited, ClockConfig(0, 0))
          ).foreach(g => await(kingdoms.insert(g)))
          def kingdomCount(boards: (GameId, UserId)*) = await(kingdoms.countInPlay(boards.toSet))
          assertEquals(kingdomCount(), 2)
          assertEquals(kingdomCount(postal -> UserId("spectator")), 2)
          assertEquals(
            kingdomCount(postal -> alice, postal -> bob, unlimited -> bob, realtime.id -> alice),
            4
          )
          assert(await(kingdoms.save(correspondence, afterElimination)))
          assertEquals(kingdomCount(postal -> alice), 2)
          assertEquals(kingdomCount(postal -> bob), 3)
          assert(
            await(
              kingdoms.save(afterElimination, afterElimination.resign(bob, now.toEpochMilli).toOption.get)
            )
          )
          assertEquals(kingdomCount(postal -> bob), 2)
        finally
          await(db.drop())
          await(driver.close())
