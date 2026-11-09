package controllers

import play.api.libs.json.Json

import lila.app.{ *, given }
import lila.ublog.UblogTranslation

final class I18n(env: Env) extends LilaController(env):

  def select = OpenBody:
    bindForm(lila.i18n.LangForm.select)(
      _ => notFound,
      code =>
        val lang = lila.i18n.LangPicker.byStr(code).err("Universe is collapsing")
        ctx.me.filterNot(_.lang contains lang.code).so {
          env.user.repo.setLang(_, lang)
        } >> negotiate(
          html = returnTo(lang.code).map: target =>
            val redir = Redirect(target)
            if ctx.isAnon
            then redir.withCookies(env.security.lilaCookie.session("lang", lang.code))
            else redir
          ,
          Ok(Json.obj("lang" -> lang.code))
        ).map(
          _.withCookies(env.security.lilaCookie.cookie("blogLanguage", UblogTranslation.normalize(lang.code)))
        )
    )

  // Only the language-selection action changes the selected edition. Explicit
  // article URLs still render their own language on ordinary requests.
  private val articlePath = """^/@/[^/]+/blog/[^/]+/(\w{8})(?:/[^/]+)?$""".r

  private def returnTo(language: String)(using Context): Fu[String] =
    val pageUrl = lila.common.HTTPRequest
      .referer(ctx.req)
      .flatMap: value =>
        scala.util
          .Try(new java.net.URI(value).parseServerAuthority())
          .toOption
          .filter: uri =>
            Option(uri.getRawAuthority).contains(ctx.req.host) &&
              Set("http", "https").contains(uri.getScheme)
    val path = pageUrl
      .flatMap(uri => Option(uri.getRawPath))
      .filter(p => p.startsWith("/") && !p.startsWith("//"))
      .getOrElse("/")
    val target = path + pageUrl.flatMap(uri => Option(uri.getRawQuery)).fold("")("?" + _)
    path match
      case articlePath(id) =>
        env.ublog.api
          .getPost(UblogPostId(id))
          .map:
            _.filter(_.canView).fold(target)(post =>
              UblogTranslation.urlOf(post, UblogTranslation.preferred(post, language)).url
            )
      case _ => fuccess(target)
