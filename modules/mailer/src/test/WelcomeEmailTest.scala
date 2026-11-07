package lila.mailer

import play.api.i18n.Lang

import lila.core.config.RouteUrl
import lila.core.i18n.I18nKey
import lila.core.i18n.I18nKey.emails as trans

class WelcomeEmailTest extends munit.FunSuite:
  lila.i18n.EmailTranslations.load()
  given lila.core.i18n.Translator = lila.i18n.Translator
  private val routeUrl: RouteUrl = call => Url(s"https://lixiangqi.com${call.url}")

  private val requiredKeys = List(
    trans.welcome_subject,
    trans.welcome_intro,
    trans.welcome_play,
    trans.welcome_playTip,
    trans.welcome_puzzles,
    trans.welcome_puzzlesTip,
    trans.welcome_profile,
    trans.welcome_profileTip,
    trans.welcome_viewProfile,
    trans.welcome_editProfile,
    trans.welcome_closing,
    trans.common_note,
    trans.common_contact,
    I18nKey.site.readAboutOur,
    I18nKey.site.privacyPolicy
  )

  for language <- lila.i18n.LangList.popular.map(_.code) do
    test(s"welcome alternatives have safe, matching destinations and localized content: $language"):
      given Lang = Lang(language)
      for key <- requiredKeys do
        assert(lila.i18n.EmailTranslations.hasOwnTranslation(summon[Lang], key), s"$language: $key")
      val message = WelcomeEmail.message(UserName("NewPlayer"), EmailAddress("new@example.com"), routeUrl)
      assert(message.subject.contains("NewPlayer"), language)
      val html = Mailer.html.wrap(message.subject, message.htmlBody.get).render
      val direction =
        if Set("ar-SA", "fa-IR", "he-IL", "ur-PK", "ps-AF", "ckb-IR")(language) then "rtl" else "ltr"
      assert(html.contains(s"dir=\"$direction\""), language)
      for destination <- List("/", "/training", "/account/profile", "/@/NewPlayer", "/contact", "/privacy") do
        val url = s"https://lixiangqi.com$destination"
        assert(html.contains(s"href=\"$url\""), url)
        assert(message.text.contains(url), url)
      for obsolete <- List("lichess.org", "lixiangqi.org", "emails:welcome", "<script") do
        assert(!html.contains(obsolete), obsolete)
        assert(!message.text.contains(obsolete), obsolete)
      assert(!message.text.contains("<a "))
      assert(html.contains("<h1"))
      assert(!html.contains("<img")) // No external images or tracking pixels needed to read the email.
      if language == "zh-CN" then assert(message.text.contains("开始下象棋"))
      if language == "zh-TW" then assert(message.text.contains("開始下象棋"))
      if language == "vi-VN" then assert(message.text.contains("Chơi cờ tướng"))
      if language == "es-ES" then assert(message.text.contains("Jugar al xiangqi"))
      if language.startsWith("pt-") then assert(message.text.contains("Jogar xiangqi"))
      sys.props
        .get("mailer.previewDir")
        .foreach: directory =>
          val path = java.nio.file.Path.of(directory)
          java.nio.file.Files.createDirectories(path)
          java.nio.file.Files.writeString(path.resolve(s"welcome-$language.html"), html)

  test("browser language codes resolve to the supported email locales"):
    for (requested, expected) <- List(
        "vi" -> "vi-VN",
        "vi-VN" -> "vi-VN",
        "es" -> "es-ES",
        "es-MX" -> "es-ES",
        "pt" -> "pt-BR",
        "pt-BR" -> "pt-BR",
        "pt-PT" -> "pt-PT"
      )
    do assertEquals(lila.i18n.LangPicker.byStrOrDefault(Some(requested)).code, expected)

  test("user text is escaped in HTML without corrupting the plain text"):
    given Lang = Lang("en-GB")
    val message = WelcomeEmail.message(UserName("<b>&Player"), EmailAddress("new@example.com"), routeUrl)
    val html = Mailer.html.wrap(message.subject, message.htmlBody.get).render
    assert(!html.contains("<b>"))
    assert(html.contains("&lt;b&gt;&amp;Player"))
    assert(message.text.contains("<b>&Player"))
