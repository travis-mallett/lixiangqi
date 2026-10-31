package lila.ui

import ScalatagsTemplate.{ *, given }

/** Shared branding for sign-in and identity verification. */
final class ProviderUi(helpers: Helpers):
  import helpers.*

  def icon(id: String) = img(
    cls := s"provider-icon provider-icon--$id",
    src := assetUrl(s"images/auth/$id.${if id == "google" then "png" else "svg"}"),
    alt := "",
    widthA := 20,
    heightA := 20
  )

  def buttons(providers: List[(String, String)], destination: String => String)(using Translate) =
    div(cls := "auth-providers"):
      providers
        .map: (id, name) =>
          postForm(action := destination(id))(
            submitButton(cls := s"auth-provider auth-provider--$id")(
              icon(id),
              span(trans.site.continueWithProvider(name))
            )
          )
