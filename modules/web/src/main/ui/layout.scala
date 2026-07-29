package lila.web
package ui

import play.api.i18n.Lang
import scalalib.model.Language

import lila.core.i18n.I18nModule
import lila.core.report.ScoreThresholds
import lila.ui.*

import ScalatagsTemplate.{ *, given }

final class layout(helpers: Helpers, assetHelper: lila.web.ui.AssetFullHelper)(
    popularAlternateLanguages: List[Language],
    reportScoreThreshold: () => ScoreThresholds,
    reportScore: () => Int
):
  import helpers.{ *, given }
  import assetHelper.{ defaultCsp, netConfig, cashTag, siteName }

  val doctype = raw("<!DOCTYPE html>")
  def htmlTag(using lang: Lang) = html(st.lang := lang.code, dir := isRTL(lang).option("rtl"))
  val topComment = raw("""<!-- Lixiangqi is open source! See https://lixiangqi.org/source -->""")
  val charset = raw("""<meta charset="utf-8">""")
  val viewport = raw:
    """<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,viewport-fit=cover">"""
  def metaCsp(csp: ContentSecurityPolicy): Frag = raw:
    s"""<meta http-equiv="Content-Security-Policy" content="${lila.web.ContentSecurityPolicy.render(csp)}">"""
  def metaCsp(csp: Option[ContentSecurityPolicy])(using Context, Option[Nonce]): Frag =
    metaCsp(csp.getOrElse(defaultCsp))
  def systemThemeScript(nonce: Option[Nonce]) =
    embedJsUnsafe(
      "if (window.matchMedia('(prefers-color-scheme: light)')?.matches) " +
        "document.documentElement.classList.add('light');"
    )(nonce)
  val noTranslate = raw("""<meta name="google" content="notranslate">""")

  private def fontPreload(path: String) = preload(assetUrl(s"font/$path"), "font", true, "font/woff2".some)

  def fontsPreload(using ctx: Context) = frag(
    fontPreload("lichess.woff2"),
    fontPreload("noto-sans-latin.woff2"),
    fontPreload("roboto-latin.woff2"),
    ctx.pref.pieceNotationIsLetter.not.option(fontPreload("lichess-chess.woff2"))
  )

  def allNotifications(challenges: Int, notifs: Int)(using Translate) =
    val challengeTitle = trans.challenge.challengesX.txt(challenges)
    val notifTitle = trans.site.notificationsX.txt(notifs)
    spaceless:
      s"""
<div>
  <button id="challenge-toggle" class="toggle link" type="button">
    <span title="$challengeTitle" role="status" aria-label="$challengeTitle" class="data-count" data-count="$challenges" data-icon="${Icon.Swords}"></span>
  </button>
  <div id="challenge-app" class="dropdown"></div>
</div>
<div>
  <button id="notify-toggle" class="toggle link" type="button">
    <span title="$notifTitle" role="status" aria-label="$notifTitle" class="data-count" data-count="$notifs" data-icon="${Icon.BellOutline}"></span>
  </button>
  <div id="notify-app" class="dropdown"></div>
</div>"""

  def clinput(using ctx: Context) =
    val label = trans.search.search.txt()
    div(id := "clinput")(
      a(cls := "link", dataIcon := Icon.Search),
      input(
        spellcheck := "false",
        autocomplete := ctx.blind.toString,
        aria.label := label,
        placeholder := label,
        enterkeyhint := "search"
      )
    )

  val warnNoAutoplay =
    div(id := "warn-no-autoplay")(
      a(dataIcon := Icon.Mute, targetBlank, href := s"${routes.Main.faq}#autoplay")
    )

  def botImage = img(
    src := staticAssetUrl("images/icons/bot.webp"),
    title := "Robot Xiangqi",
    style := "display:inline;width:34px;height:34px;vertical-align:top;margin-right:5px;vertical-align:text-top"
  )

  val manifests = raw("""<link rel="manifest" href="/manifest.json">""")
  val noRobots = raw("""<meta content="noindex,nofollow" name="robots">""")

  val favicons = raw:
    val path = s"$assetBaseUrl/assets/logo"
    s"""<link rel="alternate icon" type="image/png" href="$path/lichess-favicon-64.png">""" +
      s"""<link id="favicon" rel="icon" type="image/svg+xml" href="$path/lichess-favicon.svg">"""

  def blindModeForm(using ctx: Context) = raw:
    val btnText =
      if ctx.blind
      then trans.site.disableBlindMode.txt()
      else s"${trans.site.accessibility.txt()} - ${trans.site.enableBlindMode.txt()}"
    def tutorialLink = ctx.blind.so:
      val url = routes.Cms.lonePage(lila.core.id.CmsPageKey("blind-mode-tutorial"))
      s"""&nbsp;-&nbsp;${a(href := url)("Blind mode tutorial")}"""

    s"""<form id="blind-mode" action="${routes.Main.toggleBlindMode}" method="POST"><input type="hidden" name="enable" value="${
        if ctx.blind then 0 else 1
      }"><input type="hidden" name="redirect" value="${ctx.req.path}"><button id="nvui-button" type="submit">$btnText</button>$tutorialLink</form>"""

  val assetsMissingTroubleshooting = raw:
    """<h2 id="assets-missing"><a href="/page/network-administrators">Your network blocks the Lixiangqi assets!</a></h2>"""

  def zenZone(using Translate) = spaceless:
    s"""
<div id="zenzone">
  <a href="/" class="zen-home"></a>
  <a data-icon="${Icon.Checkmark}" id="zentog" class="text fbt active">${trans.preferences.zenMode
        .txt()}</a>
</div>"""

  def dasher(me: User) =
    div(cls := "dasher")(
      button(id := "user_tag", cls := "toggle link")(me.username),
      div(id := "dasher_app", cls := "dropdown")
    )

  def anonDasher(using ctx: Context) =
    val prefs = trans.preferences.preferences.txt()
    frag(
      div(cls := "signin-or-signup")(
        a(
          href := s"${routes.Auth.login.url}?referrer=${ctx.req.path}",
          cls := "button button-empty signin",
          testId("login")
        )(
          trans.site.signIn()
        ),
        a(href := routes.Auth.signup, cls := "button signup")(trans.site.signUp())
      ),
      div(cls := "dasher")(
        button(cls := "toggle anon link", title := prefs, aria.label := prefs, dataIcon := Icon.Gear),
        div(id := "dasher_app", cls := "dropdown")
      )
    )

  def sitePreload(i18nMods: List[I18nModule.Selector], modules: EsmList)(using ctx: Context) =
    val i18nModules = i18nMods.map(mod => s"i18n/${mod(I18nModule)}.${ctx.lang.code}")
    scriptsPreload(i18nModules ::: "site" :: modules.map(_.map(_.key)).flatten)

  def scriptsPreload(keys: List[String]) =
    frag(cashTag, assetHelper.manifest.jsAndDeps("manifest" :: keys).map(jsTag))

  private def jsTag(name: String): Frag =
    script(tpe := "module", src := staticCompiledUrl(name))

  def modulesInit(modules: EsmList, nonce: Optionce) =
    modules.flatMap(_.map(_.init(nonce))) // in body

  def inlineJs(nonce: Nonce, modules: EsmList = Nil): Frag =
    val code =
      (Esm("site").some :: modules)
        .flatMap(_.flatMap(m => assetHelper.manifest.inlineJs(m.key).map(js => s"(function(){${js}})()")))
        .mkString(";")
    embedJsUnsafe(code)(nonce.some)

  private def hrefLang(langStr: String, path: String) =
    s"""<link rel="alternate" hreflang="$langStr" href="$netBaseUrl$path"/>"""

  def hrefLangs(path: LangPath) = raw:
    val pathEnd = if path.value == "/" then "" else path.value
    hrefLang("x-default", path.value) + hrefLang("en", path.value) +
      popularAlternateLanguages.map { l =>
        hrefLang(l.value, s"/$l$pathEnd")
      }.mkString

  def pageZoom(using ctx: Context): Int = {
    def oldZoom = ctx.req.session.get("zoom2").flatMap(_.toIntOption).map(_ - 100)
    ctx.req.cookies
      .get("zoom")
      .map(_.value)
      .flatMap(_.toIntOption)
      .orElse(oldZoom)
      .filter(0 <=)
      .filter(100 >=)
  } | 80

  val dailyNewsAtom = link(
    href := routes.Feed.atom,
    st.title := "Lixiangqi Updates Feed",
    tpe := "application/atom+xml",
    rel := "alternate"
  )

  val dataVapid = attr("data-vapid")
  def dataSocketDomains = attr("data-socket-domains") := netConfig.socketDomains.mkString(",")
  val dataNonce = attr("data-nonce")
  val dataAnnounce = attr("data-announce")
  val dataSoundSet = attr("data-sound-set")
  val dataMusicSet = attr("data-music-set")
  val dataUiTheme = attr("data-ui-theme")
  val dataColorScheme = attr("data-color-scheme")
  val dataDirection = attr("data-direction")
  val dataBoard = attr("data-board")
  val dataPieceSet = attr("data-piece-set")
  val dataAssetUrl = attr("data-asset-url") := netConfig.assetBaseUrl.value
  val dataAssetVersion = attr("data-asset-version")

  val spinnerMask = raw:
    """<svg width="0" height="0"><mask id="spinner-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="50" height="50"><g fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="25" cy="25" r="22"/><circle cx="25" cy="25" r="16"/><path d="M17 16h16M17 34h16M18 18l14 14M32 18 18 32M25 13v24"/></g></mask></svg>"""

  val networkAlert = a(id := "network-status", cls := "link text", dataIcon := Icon.ChasingArrows)

  private val spaceRegex = """\s{2,}+""".r
  def spaceless(html: String) = raw(spaceRegex.replaceAllIn(html.replace("\\n", ""), ""))

  def lichessFontFaceCss = spaceless:
    s"""
<style>
  @font-face {
    font-family: 'lichess';
    font-display: block;
    src: url('${assetUrl("font/lichess.woff2")}') format('woff2')
  }
</style>"""

  def bottomHtml(using ctx: Context) = frag(
    ctx.me
      .exists(_.enabled.yes)
      .option(
        div(id := "friend_box")(
          div(cls := "friend_box_title")(
            trans.site.nbFriendsOnline.plural(0, iconTag(Icon.UpTriangle))
          ),
          div(cls := "content_wrap none")(
            div(cls := "content list")
          )
        )
      ),
    Option.when(netConfig.socketDomains.nonEmpty)(networkAlert),
    spinnerMask
  )

  object siteHeader:

    private val topnavToggle = spaceless:
      """
<input type="checkbox" id="tn-tg" class="topnav-toggle fullscreen-toggle" autocomplete="off" aria-label="Navigation">
<label for="tn-tg" class="fullscreen-mask"></label>
<label for="tn-tg" class="hbg"><span class="hbg__in"></span></label>"""

    private def privileges(using Context) =
      if Granter.opt(_.SeeReport) then
        val threshold = reportScoreThreshold()
        val maxScore = reportScore()
        a(
          cls := List(
            "link data-count report-maxScore link-center" -> true,
            "report-maxScore--high" -> (maxScore > threshold.high),
            "report-maxScore--low" -> (maxScore <= threshold.mid)
          ),
          title := "Moderation",
          href := routes.Report.list,
          dataCount := maxScore,
          dataIcon := Icon.Agent
        ).some
      else if Granter.opt(_.PublicChatView) then
        a(
          cls := "link",
          title := "Moderation",
          href := routes.Mod.publicChat,
          dataIcon := Icon.Agent
        ).some
      else
        (Granter.opt(_.Pages) || Granter.opt(_.ManageEvent)).option(
          a(
            cls := "link",
            title := "Content",
            href := Granter.opt(_.Pages).option(routes.Cms.index).orElse(routes.Event.manager().some),
            dataIcon := Icon.InkQuill
          )
        )

    private def teamRequests(nb: Int)(using Translate) =
      Option.when(nb > 0):
        a(
          cls := "link data-count link-center",
          href := routes.Team.requests,
          dataCount := nb,
          dataIcon := Icon.Group,
          title := trans.team.teams.txt()
        )

    private val siteNameFrag: Frag =
      if siteName == "lixiangqi.org" then frag("lixiangqi")
      else frag(siteName)

    def apply(
        zenable: Boolean,
        isAppealUser: Boolean,
        challenges: Int,
        notifications: Int,
        error: Boolean,
        topnav: Frag
    )(using ctx: PageContext) =
      header(id := "top")(
        div(cls := "site-title-nav")(
          (!isAppealUser).option(topnavToggle),
          a(cls := "site-title", href := langHref("/"), testId("site-title"))(
            if ctx.kid.yes then span(title := trans.site.kidMode.txt(), cls := "kiddo")(":)")
            else ctx.isBot.option(botImage),
            div(cls := "site-icon")(lila.web.ui.bits.logo),
            div(cls := "site-name")(siteNameFrag)
          ),
          (!isAppealUser).option(
            frag(
              topnav,
              (ctx.kid.no && !ctx.me.exists(_.isPatron) && !zenable).option(
                a(cls := "site-title-nav__donate")(href := routes.Plan.index())(trans.patron.donate())
              )
            )
          ),
          ctx.blind.option(h2("Navigation"))
        ),
        div(cls := "site-buttons")(
          warnNoAutoplay,
          (!isAppealUser).option(clinput),
          privileges,
          teamRequests(ctx.teamNbRequests),
          if isAppealUser then
            postForm(action := routes.Auth.logout):
              submitButton(cls := "button button-red link")(trans.site.logOut())
          else
            ctx.me
              .map: me =>
                frag(allNotifications(challenges, notifications), dasher(me))
              .getOrElse:
                error.not.option(anonDasher)
        )
      )

  private val rtlCache = scala.collection.mutable.HashMap.empty[Lang, Boolean]

  private def isRTL(lang: Lang): Boolean =
    rtlCache.getOrElseUpdate(
      lang,
      lang.locale
        .getDisplayName(lang.locale)
        .headOption
        .map(_.getDirectionality)
        .exists: dir =>
          dir == Character.DIRECTIONALITY_RIGHT_TO_LEFT ||
            dir == Character.DIRECTIONALITY_RIGHT_TO_LEFT_ARABIC
    )
