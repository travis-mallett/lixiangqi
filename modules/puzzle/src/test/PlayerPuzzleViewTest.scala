package lila.puzzle

import play.api.i18n.Lang
import lila.core.i18n.*
import lila.core.user.*
import lila.ui.{ Context, Helpers }

class PlayerPuzzleViewTest extends munit.FunSuite:
  private val translatorStub = new Translator:
    def to(lang: Lang) = Translate(this, lang)
    def toDefault = to(defaultLang)
    def duration(d: java.time.Duration, minutes: Option[Boolean], days: Boolean)(using Lang) = d.toString
    val txt = new TranslatorTxt:
      def literal(key: I18nKey, args: Seq[Any], lang: Lang) = s"${key.value} ${args.mkString(" ")}".trim
      def plural(key: I18nKey, count: lila.core.i18n.Count, args: Seq[Any], lang: Lang) =
        literal(key, args, lang)
    val frag = new TranslatorFrag:
      def literal(key: I18nKey, args: Seq[Matchable], lang: Lang) =
        scalatags.Text.RawFrag(txt.literal(key, args, lang))
      def plural(key: I18nKey, count: lila.core.i18n.Count, args: Seq[Matchable], lang: Lang) =
        literal(key, args, lang)

  // Only pure rendering is exercised. Unexpected service access fails immediately.
  private val helpers = new Helpers:
    val translator = translatorStub
    val ratingApi: lila.ui.RatingApi = null
    val langList: LangList = null
    val namer: lila.core.game.Namer = null
    def netBaseUrl = throw new AssertionError("netBaseUrl")
    def routeUrl = throw new AssertionError("routeUrl")
    def assetBaseUrl = throw new AssertionError("assetBaseUrl")
    def assetUrl(path: String) = throw new AssertionError("assetUrl")
    def safeJsonValue(value: play.api.libs.json.JsValue) = throw new AssertionError("safeJsonValue")
    def imageGetOrigin = throw new AssertionError("imageGetOrigin")
    def flairApi = throw new AssertionError("flairApi")
    def isOnline = throw new AssertionError("isOnline")
    def lightUserSync = throw new AssertionError("lightUserSync")
    def lightTeamSync = throw new AssertionError("lightTeamSync")
    def syncBelongsTo = throw new AssertionError("syncBelongsTo")
    def isProd = false
    def richText(text: String, nl2br: Boolean, expandImg: Boolean)(using lila.core.config.NetDomain) =
      throw new AssertionError("richText")

  private def player(name: String) = User(
    id = UserId(name.toLowerCase),
    username = UserName(name),
    count = lila.core.user.Count(0, 0, 0, 0, 0),
    enabled = UserEnabled(true),
    roles = Nil,
    playTime = None,
    createdAt = java.time.Instant.EPOCH,
    seenAt = None,
    kid = KidMode(false),
    lang = None,
    plan = Plan(0, false, false, None),
    hasEmail = false
  )
  private val viewer = player("Viewer")
  private val selected = player("OtherPlayer")
  private given Context = new Context:
    val req: play.api.mvc.RequestHeader = null
    val lang = defaultLang
    def me = Some(Me(viewer))
    def user = Some(viewer)
    def userId = Some(viewer.id)
    def isAuth = true
    def isOAuth = false
    def translate = translatorStub.toDefault
    def pref = throw new AssertionError("pref")
    def ip = throw new AssertionError("ip")
    def blind = false
    def isBot = false
    def kid = KidMode(false)

  private val bits = new ui.PuzzleBits(helpers)
  private val view = new ui.PuzzleUi(helpers, bits)

  test("player search sidebar stays personal when another player is selected"):
    val html = view.ofPlayer(selected.username.value, Some(selected), None).body.get.render
    val sidebar = html.take(html.indexOf("page-menu__content"))
    assert(sidebar.contains("/training/history"))
    assert(sidebar.contains("/training/dashboard"))
    assert(!sidebar.contains("?u="))
    assert(!sidebar.contains("OtherPlayer"))

  test("authorized selected-player sidebar context is preserved elsewhere"):
    val html = bits.pageMenu("history", Some(selected)).render
    assert(html.contains("u=OtherPlayer"))

  test("unresolved explicit search renders status and retains editable input"):
    val query = "qa-no-such-player-91736"
    val page = view.ofPlayer(query, None, None)
    val html = page.body.get.render
    assertEquals(page.title, "puzzle:lookupOfPlayer")
    assert(html.contains(s"value=\"$query\""))
    assert(html.contains("role=\"status\""))
    assert(html.contains(s"usernameNotFound $query"))
    assert(!html.contains("fromMyGamesNone"))
