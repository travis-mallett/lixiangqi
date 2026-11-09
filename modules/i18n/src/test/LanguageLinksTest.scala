package lila.i18n

import play.api.i18n.Lang
import scalalib.model.Language

class LanguageLinksTest extends munit.FunSuite:
  test("explicit Chinese and Vietnamese URLs resolve without language negotiation"):
    assertEquals(LangPicker.byHref(Language("zh")), LangPicker.ByHref.Found(Lang("zh", "CN")))
    assertEquals(LangPicker.byHref(Language("vi")), LangPicker.ByHref.Found(Lang("vi", "VN")))
    assertEquals(LangPicker.byHref(Language("en")), LangPicker.ByHref.Found(Lang("en", "US")))
    assertEquals(LangPicker.byHref(Language("zz")), LangPicker.ByHref.NotFound)

  test("search alternates always include the primary audiences without duplicates"):
    val languages = LangList.popularAlternateLanguages
    assert(languages.contains(Language("zh")))
    assert(languages.contains(Language("vi")))
    assertEquals(languages.distinct, languages)
