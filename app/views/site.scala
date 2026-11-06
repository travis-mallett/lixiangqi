package views.site

import lila.app.UiEnv.{ *, given }
import lila.cms.CmsPage

val message = lila.web.ui.SiteMessage(helpers)
val ui = lila.web.ui.SitePages(helpers)

object page:

  private val faqUi = lila.web.ui.FaqUi(helpers, ui)

  def faq(using Context) = faqUi.apply.js(esmInitBit("faq"))

  def withMenu(active: String, p: CmsPage.Render)(using Context) =
    ui.SitePage(
      title = p.title,
      active = active,
      contentCls = "page box box-pad force-ltr"
    ).css("bits.page")
      .headAppend(views.cms.alternateMarkdown(p)):
        views.cms.pageContent(p)

  def contact(using Context) =
    ui.SitePage(
      title = trans.contact.contact.txt(),
      active = "contact",
      contentCls = "page box box-pad"
    ).css("bits.contact")
      .js(esmInitBit("contact"))(lila.web.ui.contact(netConfig.email))

  def webmasters(using Context) =
    ui.webmasters(lila.pref.PieceSets.all.map(_.key))

object variant:

  def threeKingdoms(using Context) =
    val t = trans.threeKingdoms
    page(title = t.title.txt(), klass = "box-pad page variant", kingdomsActive = true):
      frag(
        h1(t.title()),
        div(cls := "body")(
          h2(trans.site.jieqiSetupHeading()),
          p(t.rulesIntro()),
          p(t.timeControl()),
          h2(trans.site.jieqiMovementHeading()),
          p(t.rulesMovement()),
          p(t.rulesFlyingGeneral()),
          p(t.rulesSoldier()),
          h2(trans.site.jieqiWinningHeading()),
          p(t.rulesCapture()),
          p(t.rulesTurnOrder()),
          p(t.rulesWithdrawal()),
          p(t.rulesFallen()),
          p(t.rulesStalemate()),
          p(t.rulesDuel()),
          p(t.rulesDraw()),
          p(t.rulesPerpetual()),
          p(t.rulesRating()),
          p(t.rulesConvention()),
          a(cls := "button", href := "/?variant=threeKingdoms")(t.title())
        )
      )

  def manchu(using Context) =
    page(title = trans.site.manchuTitle.txt(), klass = "box-pad page variant", manchuActive = true):
      frag(
        h1(trans.site.manchuTitle()),
        h2(trans.site.manchuLearnToPlay()),
        div(cls := "body")(
          h2(trans.site.jieqiSetupHeading()),
          p(trans.site.manchuSetupText()),
          h2(trans.site.jieqiMovementHeading()),
          p(trans.site.manchuMovementText()),
          h2(trans.site.jieqiWinningHeading()),
          p(trans.site.manchuWinningText()),
          p(trans.site.manchuRankExplanation()),
          a(cls := "button", href := "/?variant=manchu")(trans.site.playRatedManchu())
        )
      )

  def miniXiangqi(using Context) =
    page(title = trans.site.miniXiangqiTitle.txt(), klass = "box-pad page variant", miniActive = true):
      frag(
        h1(trans.site.miniXiangqiTitle()),
        h2(trans.site.miniXiangqiLearnToPlay()),
        div(cls := "body")(
          h2(trans.site.jieqiSetupHeading()),
          p(trans.site.miniXiangqiSetupText()),
          h2(trans.site.jieqiMovementHeading()),
          p(trans.site.miniXiangqiMovementText()),
          h2(trans.site.jieqiWinningHeading()),
          p(trans.site.miniXiangqiWinningText()),
          p(trans.site.miniXiangqiRankExplanation()),
          a(cls := "button", href := "/?variant=minixiangqi")(trans.site.playRatedMiniXiangqi())
        )
      )

  def jieqi(using Context) =
    page(title = trans.site.jieqiTitle.txt(), klass = "box-pad page variant", jieqiActive = true):
      frag(
        h1(trans.site.jieqiTitle()),
        h2(trans.site.jieqiLearnToPlay()),
        div(cls := "body")(
          h2(trans.site.jieqiSetupHeading()),
          p(trans.site.jieqiSetupText()),
          h2(trans.site.jieqiRevealHeading()),
          p(trans.site.jieqiRevealText()),
          h2(trans.site.jieqiMovementHeading()),
          p(trans.site.jieqiMovementText()),
          h2(trans.site.jieqiCapturesHeading()),
          p(trans.site.jieqiCapturesText()),
          h2(trans.site.jieqiWinningHeading()),
          p(trans.site.jieqiWinningText()),
          a(cls := "button", href := "/?variant=jieqi")(trans.site.playRatedJieqi())
        )
      )

  def show(
      p: CmsPage.Render,
      variant: chess.variant.Variant,
      perfType: lila.rating.PerfType
  )(using Context) =
    page(
      title = s"${variant.variantTrans.txt()} â€¢ ${variant.variantTitleTrans.txt()}",
      klass = "box-pad page variant",
      active = perfType.key.some
    ).csp(_.withInlineIconFont)
      .headAppend(views.cms.alternateMarkdown(p)):
        frag(
          boxTop(h1(cls := "text", dataIcon := perfType.icon)(variant.variantTrans())),
          h2(cls := "headline")(variant.variantTitleTrans()),
          div(cls := "body expand-text")(views.cms.render(p))
        )

  def home(using Context) =
    page(title = "Lixiangqi variants", klass = "variants"):
      frag(
        h1(cls := "box__top")(trans.site.variants()),
        div(cls := "body box__pad")(
          "Xiangqi variants introduce different boards, pieces, information, or player counts while retaining a shared game-selection workflow."
        ),
        div(cls := "variants")(
          a(cls := "variant text box__pad", href := routes.Cms.threeKingdoms)(
            span(h2(trans.site.threeKingdoms()), h3(cls := "headline")(trans.threeKingdoms.title()))
          ),
          a(cls := "variant text box__pad", href := routes.Cms.manchu)(
            span(h2(trans.site.manchu()), h3(cls := "headline")(trans.site.manchuTitle()))
          ),
          a(cls := "variant text box__pad", href := routes.Cms.miniXiangqi)(
            span(h2(trans.site.miniXiangqi()), h3(cls := "headline")(trans.site.miniXiangqiTitle()))
          ),
          a(cls := "variant text box__pad", href := routes.Cms.jieqi)(
            span(h2(trans.site.jieqi()), h3(cls := "headline")(trans.site.jieqiTitle()))
          ),
          lila.rating.PerfType.variants.map: perfKey =>
            val variant = lila.rating.PerfType.variantOf(perfKey)
            val perfType = lila.rating.PerfType(perfKey)
            a(
              cls := "variant text box__pad",
              href := routes.Cms.variant(variant.key),
              dataIcon := perfType.icon
            ):
              span(
                h2(variant.variantTrans()),
                h3(cls := "headline")(variant.variantTitleTrans())
              )
        )
      )

  private def page(
      title: String,
      klass: String,
      active: Option[PerfKey] = None,
      jieqiActive: Boolean = false,
      kingdomsActive: Boolean = false,
      miniActive: Boolean = false,
      manchuActive: Boolean = false
  )(using Context) =
    Page(title)
      .css("bits.variant")
      .js(Esm("bits.expandText"))
      .wrap: body =>
        main(cls := "page-menu")(
          lila.ui.bits.pageMenuSubnav(
            a(cls := List("text" -> true, "active" -> kingdomsActive), href := routes.Cms.threeKingdoms)(
              trans.site.threeKingdoms()
            ),
            a(cls := List("text" -> true, "active" -> manchuActive), href := routes.Cms.manchu)(
              trans.site.manchu()
            ),
            a(cls := List("text" -> true, "active" -> miniActive), href := routes.Cms.miniXiangqi)(
              trans.site.miniXiangqi()
            ),
            a(cls := List("text" -> true, "active" -> jieqiActive), href := routes.Cms.jieqi)(
              trans.site.jieqi()
            ),
            lila.rating.PerfType.variants.map: perfKey =>
              val variant = lila.rating.PerfType.variantOf(perfKey)
              a(
                cls := List("text" -> true, "active" -> active.contains(perfKey)),
                href := routes.Cms.variant(variant.key),
                dataIcon := perfKey.perfIcon
              )(variant.variantTrans())
          ),
          div(cls := s"page-menu__content box $klass")(body)
        )
