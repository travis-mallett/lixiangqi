package lila.core

import lila.core.userId.*
import lila.core.email.UserStrOrEmail

class UsernameTest extends munit.FunSuite:
  test("Chinese and mixed account identities survive lookup, login and search"):
    List("石头", "象棋", "龍馬", "象棋Player88", "Player_棋", "𠮷野", "棋〇").foreach: name =>
      assert(UserStr.read(name).isDefined, name)
      assert(UserSearch.read(name).isDefined, name)
      assertEquals(UserName(name).id.value, UsernameRules.id(name))
      assertEquals(UserStrOrEmail(name).normalize.value, UsernameRules.id(name))
      assert(UsernameRules.signup.matches(name), name)
      assertEquals(
        lila.xiangqi.XiangqiAnnotations.Author("user", Some(UsernameRules.id(name)), Some(name)).name,
        Some(name)
      )

  test("length counts supplementary ideographs once"):
    assertEquals(UsernameRules.length("𠮷" * 20), 20)
    assert(UsernameRules.signup.matches("𠮷" * 20))
    assert(!UsernameRules.signup.matches("𠮷" * 21))
    assert(UserStr.read("𠮷" * 30).isDefined)
    assert(UserStr.read("𠮷" * 31).isEmpty)

  test("unsafe and ambiguous spellings are rejected"):
    List("棋", "棋/手", "棋%手", "棋 手", "棋😀", "棋\u200B手", "棋\u0301", "棋神").foreach: name =>
      assert(UserStr.read(name).isEmpty, name)

  test("shortened display names never split supplementary characters"):
    assertEquals(UsernameRules.take("棋𠮷野", 2), "棋𠮷")
    assertEquals(UsernameRules.take("棋𠮷野", 30), "棋𠮷野")
    assertEquals(UsernameRules.take("棋𠮷野", 0), "")
    assertEquals(UsernameRules.take("Alice_123", 5), "Alice")

  test("mentions preserve whole names and exclude emails and profile URLs"):
    val text = "你好@象棋Player88，@𠮷野！ contact@象棋.com https://example.com/@/象棋"
    assertEquals(UserName.atRegex.findAllMatchIn(text).map(_.group(1)).toList, List("象棋Player88", "𠮷野"))
    assertEquals(UserName.atRegex.findAllIn("@" + "棋" * 31).toList, Nil)

  test("self mention removal preserves other accounts with the same prefix"):
    assertEquals(
      UserName.removeSelfMentions("@石头 @石头棋手 @石头Player @石头_棋 @石头-棋", UserName("石头")),
      "石头 @石头棋手 @石头Player @石头_棋 @石头-棋"
    )
    assertEquals(UserName.removeSelfMentions("@Alice棋 @ALICE", UserName("Alice")), "@Alice棋 Alice")
    assertEquals(
      UserName.removeSelfMentions("你好@𠮷野！ contact@𠮷野.com https://example.com/@/𠮷野", UserName("𠮷野")),
      "你好𠮷野！ contact@𠮷野.com https://example.com/@/𠮷野"
    )
