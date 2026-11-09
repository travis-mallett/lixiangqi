package lila.security

import play.api.data.Form
import play.api.data.Forms.single
import lila.core.user.FlagCode

class SignupCountryTest extends munit.FunSuite:
  private val form = Form(single("country" -> SecurityForm.signupCountryMapping))

  test("a blank country requires an explicit opt-out"):
    val result = form.bind(Map("country.flag" -> ""))
    assert(result.hasErrors)
    assert(result.errors.exists(e => e.key == "country" && e.message == "signupCountryRequired"))

  test("a selected country becomes the profile flag"):
    val result = form.bind(Map("country.flag" -> "CN"))
    assertEquals(result.get.profileFlag, Some(FlagCode("CN")))

  test("explicit opt-out leaves the profile flag empty"):
    val result = form.bind(Map("country.optOut" -> "true"))
    assertEquals(result.get.profileFlag, None)

  test("opt-out wins over a stale country selection"):
    val result = form.bind(Map("country.flag" -> "US", "country.optOut" -> "true"))
    assertEquals(result.get.profileFlag, None)

  test("unknown flags and malformed opt-out values are rejected"):
    assert(form.bind(Map("country.flag" -> "INVALID")).hasErrors)
    assert(form.bind(Map("country.optOut" -> "yes")).hasErrors)
