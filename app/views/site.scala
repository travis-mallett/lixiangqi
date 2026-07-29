package views.site

import lila.app.UiEnv.{ *, given }
import lila.cms.CmsPage

val message = lila.web.ui.SiteMessage(helpers)
val ui = lila.web.ui.SitePages(helpers)

object page:

  private val faqUi = lila.web.ui.FaqUi(helpers, ui)(
    standardRankableDeviation = lila.rating.Glicko.standardRankableDeviation,
    variantRankableDeviation = lila.rating.Glicko.variantRankableDeviation
  )

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

  private def page(title: String, klass: String, active: Option[PerfKey] = None)(using Context) =
    Page(title)
      .css("bits.variant")
      .js(Esm("bits.expandText"))
      .wrap: body =>
        main(cls := "page-menu")(
          lila.ui.bits.pageMenuSubnav(
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
