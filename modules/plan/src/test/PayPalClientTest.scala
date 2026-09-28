package lila.plan

import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets.UTF_8
import java.util.concurrent.ConcurrentLinkedQueue
import com.sun.net.httpserver.HttpServer
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.stream.Materializer
import play.api.libs.ws.ahc.StandaloneAhcWSClient
import scala.concurrent.Await
import scala.jdk.CollectionConverters.*

class PayPalClientTest extends munit.FunSuite:
  test("capture retains authentication and uses the same retry ID over HTTP"):
    val received = new ConcurrentLinkedQueue[Map[String, String]]()
    val server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext(
      "/",
      exchange =>
        val token = exchange.getRequestURI.getPath == "/v1/oauth2/token"
        if !token then
          received.add(
            List("Authorization", "PayPal-Request-Id", "Prefer", "Content-Type").map { name =>
              name -> Option(exchange.getRequestHeaders.getFirst(name)).getOrElse("")
            }.toMap
          )
        val authenticated =
          token || exchange.getRequestHeaders.getFirst("Authorization") == "Bearer test-token"
        val json =
          if token then """{"access_token":"test-token"}"""
          else if !authenticated then """{"name":"AUTHENTICATION_FAILURE"}"""
          else
            """{"id":"ORDER-1","status":"COMPLETED","intent":"CAPTURE","purchase_units":[],"payer":{"payer_id":"PAYER-1"}}"""
        val body = json.getBytes(UTF_8)
        exchange.getRequestBody.close()
        exchange.getResponseHeaders.set("Content-Type", "application/json")
        exchange.sendResponseHeaders(if authenticated then 200 else 401, body.length)
        exchange.getResponseBody.write(body)
        exchange.close()
    )
    server.start()
    given system: ActorSystem = ActorSystem("paypal-http-test")
    given Executor = system.dispatcher
    given Scheduler = system.scheduler
    given Materializer = Materializer(system)
    given play.api.Mode = play.api.Mode.Test
    val ws = StandaloneAhcWSClient()
    try
      val client = new PayPalClient(
        ws,
        PayPalClient.Config(
          s"http://127.0.0.1:${server.getAddress.getPort}",
          "test-client",
          lila.core.config.Secret("test-secret")
        ),
        new lila.memo.CacheApi
      )
      for _ <- 1 to 2 do
        val order = Await.result(client.captureOrder(PayPalOrderId("ORDER-1")), 10.seconds)
        assertEquals(order.id.value, "ORDER-1")
      assertEquals(received.size(), 2)
      for headers <- received.asScala do
        assertEquals(headers("Authorization"), "Bearer test-token")
        assertEquals(headers("PayPal-Request-Id"), "capture-ORDER-1")
        assertEquals(headers("Prefer"), "return=representation")
        assert(headers("Content-Type").startsWith("application/json"))
    finally
      ws.close()
      Await.result(system.terminate(), 10.seconds)
      server.stop(0)
