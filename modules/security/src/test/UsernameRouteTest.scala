package lila.security

import play.api.mvc.PathBindable
import lila.ui.LilaRouter.given

class UsernameRouteTest extends munit.FunSuite:
  test("profile routes encode names exactly once and bind decoded segments"):
    val binder = summon[PathBindable[UserStr]]
    List("象棋", "象棋Player88", "𠮷野", "Alice_123").foreach: name =>
      val encoded = binder.unbind("username", UserStr(name))
      assert(encoded.forall(_ < 128))
      val decoded = java.net.URLDecoder.decode(encoded, java.nio.charset.StandardCharsets.UTF_8)
      assertEquals(decoded, name)
      assertEquals(binder.bind("username", decoded), Right(UserStr(name)))
