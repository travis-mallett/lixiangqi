package controllers

import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.util.HexFormat
import play.api.mvc.{ Headers, Result, Results }

import lila.app.*
import lila.ui.Page

/** Only credential-free display requests can opt in. Normal pages retain their layout and actions. */
private[controllers] trait MobileDisplay:
  self: LilaController =>

  protected def mobileDisplay(using ctx: Context): Boolean =
    MobileDisplay.accepts(ctx.req.headers, ctx.me.isEmpty)

  protected def quietForumDisplay(using ctx: Context): Boolean =
    mobileDisplay || ctx.req.headers.get("X-Mobile-Display").contains("live-refresh")

  protected def displayBody(body: String, mime: String, seconds: Int)(using ctx: Context): Result =
    MobileDisplay.response(body, mime, ctx.lang.code, seconds, ctx.req.headers.get("If-None-Match"))

  protected def displayPage(page: Page, seconds: Int, eligible: Boolean = true)(using
      ctx: Context
  ): Fu[Result] =
    if mobileDisplay && eligible then
      fuccess(displayBody(page.body.fold("")(_.render), "text/html; charset=utf-8", seconds))
    else
      Ok.page(page)
        .map: result =>
          val vary = result.header.headers.get("Vary").toList :+ MobileDisplay.vary
          val normal = result.withHeaders("Vary" -> vary.mkString(", "))
          if mobileDisplay then normal.withHeaders("Cache-Control" -> "no-store")
          else if ctx.req.headers.get("X-Mobile-Display").exists(Set("live", "live-refresh")) then
            normal.withHeaders("X-Mobile-Display" -> "live", "Cache-Control" -> "private, no-store")
          else normal

private[controllers] object MobileDisplay:
  val vary = "Accept, Accept-Language, X-Blog-Language, X-Mobile-Display, Authorization, Cookie"

  def accepts(headers: Headers, anonymous: Boolean): Boolean =
    anonymous && headers.get("X-Mobile-Display").contains("1") &&
      !List("Authorization", "Cookie").exists(name => headers.get(name).isDefined)

  def response(
      body: String,
      mime: String,
      language: String,
      seconds: Int,
      conditional: Option[String]
  ): Result =
    val tag = "\"" + HexFormat.of.formatHex(
      MessageDigest
        .getInstance("SHA-256")
        .digest(
          (mime + "\n" + language + "\n" + body).getBytes(UTF_8)
        )
    ) + "\""
    val matches = conditional
      .exists:
        _.split(",").exists(v => v.trim.stripPrefix("W/") == tag || v.trim == "*")
    (if matches then Results.NotModified else Results.Ok(body).as(mime)).withHeaders(
      "ETag" -> tag,
      "Vary" -> vary,
      "Cache-Control" -> s"public, max-age=$seconds",
      "X-Mobile-Display" -> "1"
    )
