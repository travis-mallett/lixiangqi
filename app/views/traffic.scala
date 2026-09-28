package views

import lila.app.UiEnv.{ *, given }
import lila.core.i18n.I18nKey

object traffic:
  private def text(key: String)(using Context) = I18nKey(s"traffic:$key")()

  def index(using Context, Me) =
    Page(text("title").render)
      .css("traffic")
      .js(PageModule("traffic", play.api.libs.json.Json.obj()))
      .i18n(_.traffic)
      .flag(_.noRobots):
        main(cls := "page-menu traffic-page")(
          views.mod.ui.menu("traffic"),
          div(cls := "page-menu__content box traffic")(
            h1(text("title")),
            p(cls := "traffic__intro")(text("intro")),
            div(id := "traffic-app", attr("aria-busy") := "true")(
              p(role := "status")(text("loading"))
            ),
            p(cls := "traffic__caption")(a(href := "https://db-ip.com")(text("geoAttribution"))),
            p(cls := "traffic__caption")(a(href := "/privacy/traffic")(text("privacyTitle")))
          )
        )

  def privacy(using ctx: Context) =
    Page(text("privacyTitle").render)
      .css("traffic")
      .js(PageModule("traffic", play.api.libs.json.Json.obj()))
      .i18n(_.traffic)
      .flag(_.noRobots):
        main(cls := "box box-pad traffic-privacy")(
          h1(text("privacyTitle")),
          p(text("privacyDescription")),
          p(text("privacyRetention")),
          form(action := "/privacy/traffic", method := "post", attr("data-traffic-privacy") := "true")(
            label(
              input(
                tpe := "checkbox",
                name := "disabled",
                value := "true",
                checked := ctx.req.cookies.get("traffic-opt-out").exists(_.value == "1")
              ),
              text("privacyDisable")
            ),
            button(cls := "button", tpe := "submit")(text("save"))
          )
        )
