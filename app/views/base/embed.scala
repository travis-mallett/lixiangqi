package views.base

import lila.app.UiEnv.{ *, given }
import lila.ui.ContentSecurityPolicy
import lila.core.i18n.I18nModule

object embed:
  /* a minimalist embed that doesn't load site.ts */
  def minimal(
      title: String,
      cssKeys: List[String] = Nil,
      modules: EsmList = Nil,
      csp: Update[ContentSecurityPolicy] = identity
  )(body: Modifier*)(using
      ctx: EmbedContext
  ) = lila.ui.Snippet:
    frag(
      page.ui.doctype,
      page.ui.htmlTag(using ctx.lang)(
        cls := Option.unless(ctx.uiTheme == lila.pref.UiThemes.system.key)(ctx.uiTheme),
        head(
          page.ui.charset,
          page.ui.viewport,
          page.ui.metaCsp(csp(embedCsp.withNonce(ctx.nonce).withInlineIconFont)),
          st.headTitle(title),
          (ctx.uiTheme == lila.pref.UiThemes.system.key).option(page.ui.systemThemeScript(ctx.nonce.some)),
          page.pieceSetImages.load(ctx.pieceSet, lila.pref.PieceSets.assets(ctx.pieceSet)),
          cssTag("lib.theme.embed"),
          cssKeys.map(cssTag),
          page.ui.scriptsPreload(modules.flatMap(_.map(_.key)))
        ),
        st.body(
          bodyModifiers,
          body,
          page.ui.inlineJs(ctx.nonce),
          page.ui.modulesInit(modules, ctx.nonce.some)
        )
      )
    )

  private def bodyModifiers(using ctx: EmbedContext) = List(
    cls := "board-embed",
    page.ui.dataSoundSet := lila.pref.SoundSets.none.key,
    page.ui.dataMusicSet := lila.pref.MusicSets.none.key,
    page.ui.dataAssetUrl,
    page.ui.dataAssetVersion := assetVersion.value,
    page.ui.dataUiTheme := ctx.uiTheme,
    page.ui.dataColorScheme := lila.pref.UiThemes(ctx.uiTheme).colorScheme.key,
    page.ui.dataPieceSet := ctx.pieceSet,
    page.ui.dataBoard := ctx.boardTheme,
    page.ui.dataSocketDomains,
    style := {
      val board = lila.pref.BoardThemes(ctx.boardTheme)
      s"---board-image:url(${assetUrl(s"images/board/${board.file}").value});" +
        s"---cg-ccw:${board.coordinateLight};---cg-ccb:${board.coordinateDark};" +
        "---cg-cs:none;---board-opacity:100;---board-brightness:100;---board-contrast:100;---board-saturation:100;---board-hue:0;"
    }
  )

  /* a heavier embed that loads site.ts and connects to WS */
  def site(
      title: String,
      cssKeys: List[String] = Nil,
      modules: EsmList = Nil,
      pageModule: Option[PageModule] = None,
      csp: Update[ContentSecurityPolicy] = identity,
      i18nModules: List[I18nModule.Selector] = Nil
  )(body: Modifier*)(using ctx: EmbedContext) = lila.ui.Snippet:
    val allModules = modules ++ pageModule.so(module => esmPage(module.name))
    frag(
      page.ui.doctype,
      page.ui.htmlTag(using ctx.lang)(
        cls := Option.unless(ctx.uiTheme == lila.pref.UiThemes.system.key)(ctx.uiTheme),
        head(
          page.ui.charset,
          page.ui.viewport,
          page.ui.metaCsp(csp(basicCsp.withNonce(ctx.nonce).withInlineIconFont)),
          st.headTitle(title),
          (ctx.uiTheme == lila.pref.UiThemes.system.key).option(page.ui.systemThemeScript(ctx.nonce.some)),
          page.pieceSetImages.load(ctx.pieceSet, lila.pref.PieceSets.assets(ctx.pieceSet)),
          cssTag("lib.theme.embed"),
          cssKeys.map(cssTag),
          page.ui.sitePreload(List[I18nModule.Selector](_.site, _.timeago) ++ i18nModules, allModules),
          page.ui.lichessFontFaceCss
        ),
        st.body(bodyModifiers)(
          body,
          page.ui.modulesInit(allModules, ctx.nonce.some),
          pageModule.map { mod => frag(jsonScript(mod.data)) }
        )
      )
    )
