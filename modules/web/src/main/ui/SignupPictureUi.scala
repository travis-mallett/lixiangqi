package lila.web.ui

import play.api.data.Form
import lila.ui.*
import lila.ui.ScalatagsTemplate.*

final class SignupPictureUi(helpers: Helpers):
  import helpers.*

  def apply(form: Form[?])(using Translate): Frag =
    form3.group(form("picture"), trans.site.profilePicture(), help = Some(trans.site.profilePictureHelp())):
      f =>
        input(
          id := form3.id(f),
          name := f.name,
          tpe := "file",
          cls := "form-control",
          attr("accept") := "image/jpeg,image/png,image/webp",
          data("size-error") := trans.site.profilePictureFormat.txt()
        )
