package lila.msg

import java.net.{ Inet4Address, InetAddress, URI, UnknownHostException }
import java.util.Base64
import java.util.concurrent.Semaphore
import org.apache.http.client.config.RequestConfig
import org.apache.http.client.methods.HttpGet
import org.apache.http.impl.client.HttpClients
import org.jsoup.Jsoup
import play.api.libs.json.*
import scala.util.{ Try, Using }

/** The composer fetches a snapshot. Displaying a received preview never contacts its publisher. */
object LinkPreview:
  private val slots = Semaphore(4)
  private val excluded = Set(
    "debuglogs.org",
    "example",
    "example.com",
    "example.org",
    "example.net",
    "invalid",
    "localhost",
    "onion",
    "test",
    "local",
    "internal",
    "home.arpa"
  )
  private val maxBytes = 1024 * 1024

  def validUrl(raw: String): Boolean = Try(URI.create(raw)).toOption.exists: uri =>
    val host = Option(uri.getHost).getOrElse("").toLowerCase(java.util.Locale.ROOT)
    raw.length <= 2048 && uri.getScheme == "https" && uri.getUserInfo == null &&
    Set(-1, 443)(uri.getPort) && host.matches("[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.[a-z]{2,63}") &&
    !excluded.exists(s => host == s || host.endsWith("." + s)) &&
    !lila.core.security.SubmissionPolicy.blocked(raw)

  // The HTTP connector dials only these resolved addresses. A redirect goes through the same resolver.
  private[msg] def publicAddress(address: InetAddress): Boolean = address match
    case ip: Inet4Address =>
      val bytes = ip.getAddress.map(_ & 255)
      val a = bytes(0)
      val b = bytes(1)
      !ip.isAnyLocalAddress && !ip.isLoopbackAddress && !ip.isSiteLocalAddress && !ip.isLinkLocalAddress &&
      a > 0 && a < 224 && !(a == 100 && b >= 64 && b <= 127) &&
      !(a == 192 && (b == 0 || b == 2 || b == 88)) &&
      !(a == 198 && Set(18, 19, 51)(b)) && !(a == 203 && b == 0)
    case _ => false

  private case class Page(uri: URI, mime: String, bytes: Array[Byte])
  private val imageTypes = Set("image/jpeg", "image/png", "image/webp", "image/gif")
  private val client = HttpClients
    .custom()
    .setDnsResolver { host =>
      val addresses = InetAddress.getAllByName(host).filter(publicAddress)
      if addresses.isEmpty then throw UnknownHostException()
      addresses
    }
    .setMaxConnTotal(4)
    .setMaxConnPerRoute(4)
    .disableRedirectHandling()
    .disableAutomaticRetries()
    .disableCookieManagement()
    .disableContentCompression()
    .setDefaultRequestConfig(
      RequestConfig
        .custom()
        .setSocketTimeout(3000)
        .setConnectTimeout(2500)
        .setConnectionRequestTimeout(1000)
        .build()
    )
    .build()

  private def fetch(uri: URI, image: Boolean, hops: Int = 0): Option[Page] =
    if hops >= 5 || !validUrl(uri.toASCIIString) then None
    else
      val req = HttpGet(uri)
      req.setHeader("User-Agent", "WhatsApp/2")
      req.setHeader("Accept", if image then "image/*" else "text/html")
      // Bound the complete request, including a server that trickles bytes indefinitely.
      val deadline = timer.schedule((() => req.abort()): Runnable, 5, java.util.concurrent.TimeUnit.SECONDS)
      val result = try
        Using.resource(client.execute(req)): res =>
          val code = res.getStatusLine.getStatusCode
          if Set(301, 302, 303, 307, 308)(code) then
            Left(Option(res.getFirstHeader("Location")).map(h => uri.resolve(h.getValue)))
          else
            val mime = Option(res.getFirstHeader("Content-Type"))
              .fold("")(_.getValue.takeWhile(_ != ';').trim.toLowerCase(java.util.Locale.ROOT))
            val accepted = imageTypes(mime) || (!image && mime == "text/html")
            val inline =
              Option(res.getFirstHeader("Content-Disposition")).forall(_.getValue.startsWith("inline"))
            Right(
              Option
                .when(code == 200 && accepted && inline)(res.getEntity)
                .filter(_ != null)
                .flatMap: entity =>
                  val bytes = entity.getContent.readNBytes(maxBytes + 1)
                  req.abort()
                  Option.when(bytes.nonEmpty && (mime == "text/html" || bytes.length <= maxBytes))(
                    Page(uri, mime, bytes.take(maxBytes))
                  )
            )
      finally
        deadline.cancel(false)
        req.abort()
      result match
        case Left(location) => location.flatMap(fetch(_, image, hops + 1))
        case Right(page) => page

  private val timer = java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r =>
    Thread.ofPlatform().daemon().name("inbox-preview-timeout").unstarted(r)
  )

  private def snapshot(url: String, page: Page, includeImage: Boolean): Option[JsObject] =
    def encode(image: Page) =
      Json.obj("mime" -> image.mime, "data" -> Base64.getEncoder.encodeToString(image.bytes))
    val (title, description, date, image) =
      if page.mime != "text/html" then
        val name = Option(page.uri.getPath).flatMap(_.split('/').lastOption).filter(_.nonEmpty)
        (name.getOrElse(page.uri.getHost).take(300), "", None, Option.when(includeImage)(page))
      else
        val doc = Jsoup.parse(java.io.ByteArrayInputStream(page.bytes), null, page.uri.toString)
        def field(selector: String, attr: String) =
          Option(doc.selectFirst(selector)).map(_.attr(attr).trim).filter(_.nonEmpty)
        def og(keys: String*) =
          keys.iterator.flatMap(k => field(s"meta[property=$k]", "content")).nextOption()
        val title = og("og:title").getOrElse(doc.title()).take(300)
        val description =
          og("og:description").orElse(field("meta[name=description]", "content")).getOrElse("").take(1000)
        val date =
          og("og:modified_time", "article:modified_time", "og:published_time", "article:published_time")
            .flatMap(s => Try(java.time.Instant.parse(s).toEpochMilli).toOption)
            .filter(d => d > 0 && d < 32503680000000L)
        val image = Option
          .when(includeImage && title.nonEmpty) {
            og("og:image", "og:image:url")
              .orElse(
                List("apple-touch-icon", "apple-touch-icon-precomposed", "shortcut icon", "icon").iterator
                  .flatMap(rel => field(s"""link[rel="$rel"]""", "href"))
                  .nextOption()
              )
              .flatMap(src => Try(fetch(page.uri.resolve(src), true)).toOption.flatten)
          }
          .flatten
        (title, description, date, image)
    Option.when(title.nonEmpty && !lila.core.security.SubmissionPolicy.blocked(title + " " + description))(
      Json.obj(
        "url" -> url,
        "title" -> title,
        "description" -> description,
        "date" -> date,
        "image" -> image.map(encode)
      )
    )

  def apply(url: String, includeImage: Boolean)(using Executor): Fu[JsObject] =
    if !validUrl(url) || !slots.tryAcquire() then fuccess(Json.obj())
    else
      scala.concurrent.Future(scala.concurrent.blocking {
        try fetch(URI.create(url), false).flatMap(snapshot(url, _, includeImage)).getOrElse(Json.obj())
        catch case scala.util.control.NonFatal(_) => Json.obj()
        finally slots.release()
      })
