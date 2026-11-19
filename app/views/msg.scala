package views.msg

import play.api.libs.json.*

import lila.app.UiEnv.{ *, given }

def home(json: JsObject)(using Context) =
  Page(trans.site.inbox.txt())
    .css("msg")
    .i18n(_.challenge)
    .i18n(_.inbox)
    .js(PageModule("msg", Json.obj("data" -> json)))
    .csp(_.withInlineIconFont):
      main(cls := "box msg-app")

def invitation(id: String, token: String, name: String)(using Context) =
  Page(trans.inbox.groupLink.txt()):
    main(cls := "box box-pad")(
      h1(name),
      postForm(action := s"/inbox/invite/$id/$token")(submitButton(cls := "button")(trans.site.join()))
    )

def joinRequested(using Context) =
  Page(trans.inbox.requestSent.txt()):
    main(cls := "box box-pad")(h1(trans.inbox.requestSent()), a(href := "/inbox")(trans.site.inbox()))
