package lila.chat

class LineTest extends munit.FunSuite:
  test("stored chat lines preserve Chinese names, text and moderation flags"):
    for
      name <- List("石头", "龍馬", "象棋Player88", "𠮷野", "Alice_123", "𠮷" * 30)
      (troll, deleted) <- List(false -> false, true -> false, false -> true)
    do
      val line = UserLine(UserName(name), "你好 @石头\n再来一局！", troll, deleted)
      assertEquals(Line.strToUserLine(Line.userLineToStr(line)), Some(line))
      assertEquals(Line.strToLine(Line.lineToStr(line)), Some(line))

  test("existing titled chat records remain readable"):
    assertEquals(
      Line.strToUserLine("GM~石头:你好"),
      Some(UserLine(UserName("石头"), "你好", troll = false, deleted = false))
    )

  test("invalid account characters do not become chat authors"):
    List("棋/手", "棋%手", "棋😀", "棋\u200B手").foreach: name =>
      assertEquals(Line.strToUserLine(s"$name hello"), None)
