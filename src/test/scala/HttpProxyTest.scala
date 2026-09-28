// Play restricts its real forwarding handler to this package. Keep the regression
// test here so it exercises that handler rather than reimplementing IP selection.
package play.core.server

import com.typesafe.config.ConfigFactory
import play.api.Configuration
import play.api.mvc.Headers
import play.api.mvc.request.RemoteConnection
import play.core.server.common.ForwardedHeaderHandler
import play.core.server.common.ForwardedHeaderHandler.ForwardedHeaderHandlerConfig

class HttpProxyTest extends munit.FunSuite:
  private val proxy = "172.30.73.2"
  private val production = Configuration(
    ConfigFactory
      .parseResources("http-proxy.conf")
      .resolveWith(ConfigFactory.parseString(s"LIXIANGQI_HTTP_PROXY_IP = \"$proxy\""))
  )
  private def connection(peer: String, forwarded: String, config: Option[Configuration] = Some(production)) =
    new ForwardedHeaderHandler(ForwardedHeaderHandlerConfig(config)).forwardedConnection(
      RemoteConnection(peer, false, None),
      Headers("X-Forwarded-For" -> forwarded, "X-Forwarded-Proto" -> "https")
    )

  test("production ingress exposes the visitor IPv4 address and original HTTPS scheme"):
    val result = connection(proxy, "8.8.8.8")
    assertEquals(result.remoteAddressString, "8.8.8.8")
    assert(result.secure)

  test("production ingress preserves visitor IPv6 addresses"):
    val result = connection(proxy, "2606:4700:4700::1111")
    assertEquals(result.remoteAddress, java.net.InetAddress.getByName("2606:4700:4700::1111"))

  test("untrusted peers cannot supply a forged visitor address or HTTPS scheme"):
    for peer <- List("172.30.73.4", "172.18.0.8", "203.0.113.20", "127.0.0.1") do
      val result = connection(peer, "8.8.8.8")
      assertEquals(result.remoteAddressString, peer)
      assert(!result.secure)

  test("a forged earlier forwarding hop cannot override the actual visitor"):
    assertEquals(connection(proxy, "1.1.1.1, 8.8.8.8").remoteAddressString, "8.8.8.8")

  test("default Play policy reproduces the Docker proxy geography failure"):
    assertEquals(connection("172.18.0.8", "8.8.8.8", None).remoteAddressString, "172.18.0.8")

  sys.env
    .get("LIXIANGQI_TRAFFIC_GEOIP_TEST_FILE")
    .foreach: path =>
      test("forwarded IPv4 and IPv6 visitors resolve through the prepared DB-IP database"):
        val geo = lila.traffic.TrafficGeoIP(path)(using scala.concurrent.ExecutionContext.global)
        try
          assert(geo.isAvailable)
          for address <- List("8.8.8.8", "1.1.1.1", "2606:4700:4700::1111") do
            val client = connection(proxy, address).remoteAddressString
            val location = geo(lila.core.net.IpAddress.unchecked(client))
            assert(location.flatMap(_.countryCode).exists(_.nonEmpty))
            assert(location.flatMap(_.region).exists(_.nonEmpty))
            assert(location.flatMap(_.city).exists(_.nonEmpty))
          assertEquals(geo(lila.core.net.IpAddress.unchecked(proxy)), None)
        finally geo.close()
