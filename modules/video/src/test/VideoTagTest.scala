package lila.video

class VideoTagTest extends munit.FunSuite:
  test("teaching tags sort by rating rather than lexical number"):
    val tags = List("12 Advanced", "3 Basic Kills", "Miscellaneous", "How to Play", "4 Tactics")
    assertEquals(
      tags.sortBy(VideoTag.naturalOrder),
      List("How to Play", "3 Basic Kills", "4 Tactics", "12 Advanced", "Miscellaneous")
    )

  test("extremely large numeric tag labels remain valid"):
    assertEquals(VideoTag.naturalOrder("999999999999999999999 Videos")._1, Int.MaxValue)

  test("sort keys reject arbitrary database expressions"):
    assertEquals(VideoSort.byKey("$where"), VideoSort.Curated)
    VideoSort.values.foreach(sort => assertEquals(VideoSort.byKey(sort.key), sort))

  test("tag links preserve exact names and independent filter values"):
    given lila.common.ClientName = lila.common.ClientName.browser
    val control = UserControl(Filter(List("1/2 & basics", "3 kills")), Nil, Some("a+b?"), VideoSort.Views)
    val decoded = control.queryString
      .split('&')
      .toList
      .map: part =>
        val pair = part.split("=", 2)
        pair(0) -> java.net.URLDecoder.decode(pair(1), java.nio.charset.StandardCharsets.UTF_8)
    assertEquals(decoded.filter(_._1 == "tag").map(_._2), List("1/2 & basics", "3 kills"))
    assert(decoded.contains("q" -> "a+b?"))
    assert(decoded.contains("sort" -> "views"))
    assertEquals(control.forTag("a/b").filter.tags, List("a/b"))

  test("all videos navigation survives paging and resets on category selection"):
    given lila.common.ClientName = lila.common.ClientName.browser
    val control = UserControl(Filter(Nil), Nil, None, allVideos = true)
    assertEquals(control.queryString, "all=1")
    assert(!control.forTag("basics").allVideos)
