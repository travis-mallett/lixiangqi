package lila.web.ui

import play.api.data.Form
import lila.ui.*
import lila.ui.ScalatagsTemplate.{ *, given }

final class SignupCountryUi(helpers: Helpers, flags: lila.core.user.FlagApi):
  import helpers.{ *, given }

  def apply(form: Form[?])(using Translate): Frag =
    val showChoice = form.errors.exists(_.key.startsWith("country")) ||
      form("country.optOut").value.contains("true")
    div(cls := "signup-country")(
      form3.group(form("country.flag"), trans.site.countryRegion()): f =>
        form3.selectLowLevel(f.name, flags.all.map(c => c.code -> c.name), f.value, default = "".some)(
          id := form3.id(f),
          cls := "form-control",
          autocomplete := "country",
          aria.describedby := "signup-country-error"
        ),
      div(cls := List("signup-country__opt-out" -> true, "none" -> !showChoice))(
        form3.checkboxGroup(form("country.optOut"), trans.site.signupCountryOptOut())
      ),
      p(
        id := "signup-country-error",
        cls := List("error" -> true, "none" -> !form.errors.exists(_.key == "country")),
        role := "alert"
      )(trans.site.signupCountryRequired())
    )
