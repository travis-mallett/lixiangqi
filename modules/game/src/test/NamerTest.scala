package lila.game

import chess.{ PlayerName, PlayerTitle, White }

import lila.core.LightUser
import lila.core.game.Player
import lila.core.id.GamePlayerId

class NamerTest extends munit.FunSuite:
  private val anonymous = Player(GamePlayerId("red1"), White, aiLevel = None)

  test("recorded identities preserve usernames without adding titles or ratings"):
    val user = LightUser.fallback(UserName("NamedPlayer")).copy(title = PlayerTitle.get("GM"))
    assertEquals(Namer.recordedPlayerText(anonymous.copy(userId = Some(user.id)), Some(user)), "NamedPlayer")
    assertEquals(
      Namer.recordedPlayerText(anonymous.copy(name = Some(PlayerName("Imported player (2100)"))), None),
      "Imported player"
    )

  test("replay and export share anonymous and computer identities"):
    assertEquals(Namer.recordedPlayerText(anonymous, None), UserName.anonymous.value)
    assertEquals(Namer.recordedPlayerText(anonymous.copy(aiLevel = Some(1)), None), "Pikafish level 1")
