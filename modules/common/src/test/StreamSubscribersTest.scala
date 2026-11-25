package lila.common

import java.util.concurrent.{ Semaphore, TimeUnit }
import scala.concurrent.{ Await, ExecutionContext }
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.stream.scaladsl.{ Sink, Source }

class StreamSubscribersTest extends munit.FunSuite:
  test("an open board stays present until its last materialized stream terminates"):
    given system: ActorSystem = ActorSystem("stream-subscribers-test")
    val completed = new Semaphore(0)
    // Wait for the subscriber's termination callback, including on a failed connection.
    given Executor = ExecutionContext.fromExecutor: task =>
      try task.run()
      finally completed.release()
    val boards = new LilaStream.Subscribers[String]
    val stream = boards.track("postal01", Source.maybe[Int])
    try
      assertEquals(boards.values, Set.empty[String])
      val first = stream.to(Sink.ignore).run()
      val reconnect = stream.to(Sink.ignore).run()
      assertEquals(boards.values, Set("postal01"))
      first.failure(new java.io.IOException("connection closed"))
      assert(completed.tryAcquire(5, TimeUnit.SECONDS))
      assertEquals(boards.values, Set("postal01"))
      reconnect.success(None)
      assert(completed.tryAcquire(5, TimeUnit.SECONDS))
      assertEquals(boards.values, Set.empty[String])
    finally Await.result(system.terminate(), 10.seconds)
