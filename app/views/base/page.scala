package views.base

import play.api.libs.json.JsString

import lila.app.UiEnv.{ *, given }
import lila.common.String.html.safeJsonValue
import lila.ui.{ RenderedPage, PageFlags }
import lila.mon.extensions.*

object page:

  val pieceSetImages = lila.web.ui.PieceSetImages(assetHelper)

  val ui = lila.web.ui.layout(helpers, assetHelper)(
    popularAlternateLanguages = lila.i18n.LangList.popularAlternateLanguages,
    reportScoreThreshold = env.report.scoreThresholdsSetting.get,
    reportScore = () => env.report.api.maxScores.dmap(_.highest).awaitOrElse(50.millis, "nbReports", 0)
  )
  import ui.*

  private val topnav = lila.web.ui.TopNav(helpers)

  private def metaThemeColor(using ctx: Context): Frag =
    raw(s"""<meta name="theme-color" content="${ctx.pref.themeColor}">""")

  private def boardPreload(using ctx: Context) =
    imagePreload(assetUrl(s"images/board/${lila.pref.BoardThemes(ctx.pref.boardTheme).file}"))

  def boardStyle(zoomable: Boolean)(using ctx: Context) =
    val board = lila.pref.BoardThemes(ctx.pref.boardTheme)
    s"---board-image:url(${assetUrl(s"images/board/${board.file}").value});" +
      s"---cg-ccw:${board.coordinateLight};" +
      s"---cg-ccb:${board.coordinateDark};" +
      "---cg-cs:none;" +
      s"---board-opacity:${ctx.pref.boardOpacity};" +
      s"---board-brightness:${ctx.pref.boardBrightness};" +
      s"---board-contrast:${ctx.pref.boardContrast};" +
      s"---board-hue:${ctx.pref.boardHue};" +
      zoomable.so(s"---zoom:$pageZoom;")

  def apply(p: Page)(using ctx: PageContext): RenderedPage =
    import ctx.pref
    val anonOnboarding = ctx.isAnon.so(lila.security.EmailConfirm.cookie.get(ctx.req))
    val allModules = p.modules ++
      p.pageModule.so(module => esmPage(module.name)) ++
      ctx.needsFp.so(fingerprintTag) ++
      anonOnboarding.isDefined.so(esmInitBit("emailErrorCheck"))
    val zenable = p.flags(PageFlags.zen)
    val playing = p.flags(PageFlags.playing)
    val pageFrag = frag(
      doctype,
      htmlTag(
        cls := List(
          ctx.pref.uiTheme ->
            (ctx.impersonatedBy.isEmpty && !ctx.blind && ctx.pref.uiTheme != lila.pref.UiThemes.system.key),
          "has-background" -> pref.backgroundImage.isDefined
        ),
        topComment,
        head(
          charset,
          viewport,
          metaCsp(p.csp.map(_(defaultCsp))),
          metaThemeColor,
          st.headTitle:
            val prodTitle = p.fullTitle | s"${p.title} • $siteName"
            if env.mode.isProd then prodTitle
            else s"${ctx.me.so(_.username.value + " ")} $prodTitle"
          ,
          cssTag("lib.theme.all"),
          cssTag("site"),
          ctx.data.inquiry.isDefined.option(cssTag("mod.inquiry")),
          ctx.impersonatedBy.isDefined.option(cssTag("mod.impersonate")),
          ctx.blind.option(cssTag("bits.blind")),
          p.cssKeys.map(cssTag),
          meta(
            content := p.openGraph.fold(trans.site.siteDescription.txt())(o => o.description),
            name := "description"
          ),
          link(rel := "mask-icon", href := staticAssetUrl("logo/lichess.svg"), attr("color") := "black"),
          favicons,
          (p.flags(PageFlags.noRobots) || !netConfig.crawlable).option(noRobots),
          noTranslate,
          p.openGraph.map(lila.web.ui.openGraph),
          p.atomLinkTag | dailyNewsAtom,
          pref.backgroundImage.map { loc =>
            val url =
              if loc.startsWith("/assets/") then assetUrl(loc.drop(8)).value
              else loc
            val safeUrl = safeJsonValue(JsString(url)).value
            raw(
              s"""<style id="bg-data">html.has-background::before{background-image:url($safeUrl);}</style>"""
            )
          },
          fontsPreload,
          boardPreload,
          manifests,
          p.withHrefLangs.map(hrefLangs),
          sitePreload(p.i18nModules, ctx.data.inquiry.isDefined.option(Esm("mod.inquiry")) :: allModules),
          lichessFontFaceCss,
          pieceSetImages.load(ctx.pref.pieceSet, lila.pref.PieceSets.assets(ctx.pref.pieceSet)),
          (ctx.pref.uiTheme == lila.pref.UiThemes.system.key || ctx.impersonatedBy.isDefined)
            .so(systemThemeScript(ctx.nonce))
        ).pipe(p.transformHead),
        st.body(
          cls := {
            val baseClass = s"coords-${pref.coordsClass}"
            List(
              baseClass -> true,
              "has-background" -> pref.backgroundImage.isDefined,
              "simple-board" -> pref.simpleBoard,
              "piece-letter" -> pref.pieceNotationIsLetter,
              "blind-mode" -> ctx.blind,
              "kid" -> ctx.kid.yes,
              "mobile" -> lila.common.HTTPRequest.isMobileBrowser(ctx.req),
              "playing fixed-scroll" -> playing,
              "no-rating" -> (!pref.showRatings || (playing && pref.hideRatingsInGame)),
              "no-flair" -> !pref.flairs,
              "zen" -> (zenable && (pref.isZen || (playing && pref.isZenAuto))),
              "zenable" -> zenable,
              "zen-auto" -> (zenable && pref.isZenAuto)
            )
          },
          dataVapid := (ctx.isAuth && env.security.lilaCookie.isRememberMe(ctx.req))
            .option(env.push.vapidPublicKey),
          dataUser := ctx.userId,
          dataUsername := ctx.username,
          dataSoundSet := pref.soundSet,
          dataMusicSet := pref.musicSet,
          attr("data-socket-domains") := (if ~pref.usingAltSocket then netConfig.socketAlts
                                          else netConfig.socketDomains).mkString(","),
          dataAssetUrl,
          dataAssetVersion := assetVersion,
          dataNonce := ctx.nonce,
          dataUiTheme := pref.uiTheme,
          dataColorScheme := pref.colorScheme,
          dataBoard := pref.boardTheme,
          dataPieceSet := pref.pieceSet,
          dataAnnounce := lila.web.AnnounceApi.get.map(a => safeJsonValue(a.json)),
          attr("data-i18n-catalog") := assetHelper.manifest
            .js(s"i18n/${ctx.lang.code}")
            .map(name => staticAssetUrl(s"compiled/$name")),
          style := boardStyle(p.flags(PageFlags.zoom))
        )(
          blindModeForm,
          assetsMissingTroubleshooting,
          for in <- ctx.data.inquiry; me <- ctx.me yield views.mod.inquiryUi(in)(using ctx, me),
          ctx.me.ifTrue(ctx.impersonatedBy.isDefined).map { views.mod.ui.impersonate(_) },
          anonOnboarding.map: u =>
            frag(cssTag("bits.email-confirm"), views.auth.checkYourEmailBanner(u.username, u.email)),
          zenable.option(zenZone),
          Option.unless(p.flags(PageFlags.noHeader)):
            ui.siteHeader(
              zenable = zenable,
              isAppealUser = ctx.isAppealUser,
              challenges = ctx.nbChallenges,
              notifications = ctx.nbNotifications.value,
              error = ctx.data.error,
              topnav = topnav()
            )
          ,
          div(
            id := "main-wrap",
            cls := List(
              "full-screen-force" -> p.flags(PageFlags.fullScreen),
              "is2d" -> true
            )
          )(p.transform(p.body)),
          bottomHtml,
          ctx.nonce.map(inlineJs(_, allModules)),
          modulesInit(allModules, ctx.nonce),
          p.pageModule.map { mod => frag(jsonScript(mod.data)) }
        )
      )
    )
    RenderedPage(pageFrag.render)
