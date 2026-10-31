package lila.setup

import lila.core.game.KidsBotProfile
import lila.core.userId.UserId

class KidsBotsTest extends munit.FunSuite:
  private val fields =
    Map("botId" -> "dou-dou", "side" -> "black", "challenge" -> "true", "requestId" -> ("a" * 48))

  test("only versioned catalog identities and bounded creation inputs are accepted"):
    assertEquals(KidsBotProfile.all.size, 26)
    assertEquals(KidsBotProfile.all.map(_.key).distinct.size, 26)
    assert(KidsBotProfile.all.forall(p => lila.core.game.AiLevel.customLevels.contains(p.level)))
    assert(KidsBots.request(fields).isRight)
    for change <- List(
        "botId" -> "arbitrary",
        "side" -> "white",
        "challenge" -> "maybe",
        "requestId" -> "short"
      )
    do assert(KidsBots.request(fields + change).isLeft)

  test("guest capabilities are hashed and never become a signed-in identity"):
    val guest = KidsBots.owner(None, Some("a" * 48)).get
    assertEquals(guest.length, 70)
    assert(!guest.contains("a" * 48))
    assertNotEquals(guest, KidsBots.owner(None, Some("b" * 48)).get)
    assertEquals(KidsBots.owner(Some(UserId("kid")), Some("a" * 48)), Some("user/kid"))
    assertEquals(KidsBots.owner(None, Some("short")), None)
