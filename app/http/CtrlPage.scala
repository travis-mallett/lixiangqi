package lila.app
package http

import play.api.mvc.*
import scalatags.Text.Frag

import lila.ui.{ Page, PageFlags, RenderedPage, Snippet }

trait CtrlPage(using Executor)
    extends RequestContext
    with ControllerHelpers
    with lila.web.ResponseHeaders
    with lila.web.ResponseWriter:

  def renderPage(page: Page)(using Context): Fu[RenderedPage] =
    pageContext.map: pctx =>
      views.base.page(page)(using pctx)

  def renderAsync(page: Fu[Page])(using Context): Fu[RenderedPage] =
    pageContext.flatMap: pctx =>
      page.map(views.base.page(_)(using pctx))

  extension (s: Status)

    def page(page: Page)(using ctx: Context): Fu[Result] =
      renderPage(page).map: rendered =>
        val result = s(rendered)
        if page.flags(PageFlags.crossSiteIsolation) then
          result.withHeaders(crossOriginPolicy.forReq(ctx.req)*)
        else result
    def async(page: Fu[Page])(using ctx: Context): Fu[Result] = page.flatMap(p => s.page(p))

    def snipAsync(frag: Fu[Frag | Snippet]): Fu[Result] = frag.dmap(snip)
    def snip(frag: Frag | Snippet): Result = s(frag.match
      case s: Snippet => s
      case f: Frag => Snippet(f))
