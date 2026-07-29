package views.base

import lila.app.UiEnv.{ *, given }

def notFound(msg: Option[String]) =
  Page(msg | "Page not found").css("bits.not-found"):
    main(cls := "not-found page-small box box-pad")(
      header(
        h1("404"),
        div(
          strong("Page not found!"),
          msg.map(em(_)),
          p(
            "Return to ",
            a(href := routes.Lobby.home)("the homepage"),
            "."
          )
        )
      )
    )

def notFoundEmbed(msg: Option[String])(using EmbedContext) =
  views.base.embed.site(title = msg | "Page not found", cssKeys = List("bits.embed-not-found"))(
    main(cls := "not-found page-small box box-pad")(
      header(
        h1("404"),
        div(
          strong("Page not found!"),
          msg.map(em(_))
        )
      )
    )
  )
