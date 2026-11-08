package lila.security

import play.api.mvc.{ PathBindable, QueryStringBindable }
import play.core.routing.{ DynamicPart, PathPattern, StaticPart }
import lila.ui.LilaRouter.given

class UsernameRouteTest extends munit.FunSuite:
  test("profile routes encode names exactly once and bind decoded segments"):
    val binder = summon[PathBindable[UserStr]]
    List("石头", "象棋", "龍馬", "象棋Player88", "𠮷野", "Alice_123", "𠮷" * 30).foreach: name =>
      val user = UserStr(name)
      val encoded = java.net.URLEncoder.encode(name, java.nio.charset.StandardCharsets.UTF_8)
      val calls = List(
        routes.User.show(user) -> ("/@/", ""),
        routes.User.showMini(user) -> ("/@/", "/mini"),
        routes.User.gamesAll(user) -> ("/@/", "/all"),
        routes.Api.user(user) -> ("/api/user/", ""),
        routes.Api.mobileProfile(user) -> ("/api/mobile/profile/", ""),
        routes.Msg.convo(user) -> ("/inbox/", ""),
        routes.Relation.follow(user) -> ("/api/rel/follow/", ""),
        routes.Game.apiExportByUser(user) -> ("/api/games/user/", ""),
        routes.Study.byOwnerDefault(user) -> ("/study/by/", "")
      )
      calls.foreach: (call, parts) =>
        val (prefix, suffix) = parts
        assertEquals(call.url, s"$prefix$encoded$suffix")
        // Use Play's incoming path decoding, as the generated forward router does.
        val pattern =
          PathPattern(
            List(
              StaticPart(prefix.stripPrefix("/")),
              DynamicPart("username", "[^/]+", true),
              StaticPart(suffix)
            )
          )
        val decoded = pattern(call.url).get("username").toOption.get
        assertEquals(binder.bind("username", decoded), Right(user))

  test("route binding rejects escaped or unsafe account names after path decoding"):
    val binder = summon[PathBindable[UserStr]]
    List("%E7%9F%B3%E5%A4%B4", "棋/手", "棋%手", "棋😀", "棋\u200B手").foreach: name =>
      assert(binder.bind("username", name).isLeft, name)

  test("of-player query parameter trims whitespace around a username"):
    val binder = summon[QueryStringBindable[String]]
    val rawName = binder.bind("name", Map("name" -> Seq("  Alice_123  "))).get.toOption.get
    assertEquals(UserStr.read(rawName), Some(UserStr("Alice_123")))
    val blankName = binder.bind("name", Map("name" -> Seq("   "))).get.toOption.get
    assertEquals(UserStr.read(blankName), None)
