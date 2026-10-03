package lila.playerDirectory

import lila.core.playerDirectory.{ PlayerId, PlayerTitle, Provenance }

class WxfRosterTest extends munit.FunSuite:
  private val source = Provenance(
    "wxf",
    "https://www.wxf-xiangqi.org/images/Player_Titled_List/20221209_WXF_Official_list_of_titles20221209-.pdf",
    "2022-12-09"
  )
  private val roster = """世界象棋联合会国际等级称号棋手名单
IGM0012 中国 China 许银川 Xu Yinchuan 男 Male 国际特级大师 International Grandmaster
IGM0046 德国 Germany 薛忠 Xue Zhong 男 Male 国际特级大师 International Grandmaster
IFM0019 日本 Japan 所司和晴 Shoshi Kazuharu 男 Male 棋联大师 Federation Master
"""

  test("official native identities, bilingual aliases and dated titles never create ratings"):
    val players = WxfRoster.parse(roster, source)
    assertEquals(players.map(_.id.value), List("wxf:IGM0012", "wxf:IGM0046", "wxf:IFM0019"))
    assertEquals(players.head.title, PlayerTitle.get("IGM"))
    assertEquals(players.head.aliases.map(_.value), List("许银川"))
    assert(players.head.tokens.contains("许银川"))
    assert(players.forall(p => p.provenance == source && p.ratingsMap.isEmpty && p.standardK.isEmpty))

  test("identities are namespaced and numeric foreign IDs cannot be interpreted"):
    assertEquals(PlayerId.parse("123456"), None)
    assertEquals(PlayerId.parse("wxf:IGM0012").map(_.value), Some("wxf:IGM0012"))
    assertEquals(PlayerTitle.get("WGM"), None)
    assertEquals(PlayerId.parse("wxf:IGM0012/evil"), None)

  test("whole malformed publications fail before persistence"):
    intercept[IllegalArgumentException](WxfRoster.parse(roster + "IGMbad China", source))
    intercept[IllegalArgumentException](WxfRoster.parse(roster + roster, source))
    intercept[IllegalArgumentException](
      WxfRoster.parse(roster.replace("International Grandmaster", "International Master"), source)
    )
    intercept[IllegalArgumentException](WxfRoster.parse(roster.replace("中国 China", "未知 Unknown"), source))

  test("publication discovery accepts only the official bounded PDF location and explicit date"):
    assertEquals(
      WxfRoster.publication(s"<a href='${source.url}'>WXF titles</a>"),
      (source.url, source.publishedAt)
    )
    intercept[IllegalArgumentException](
      WxfRoster.publication("<a href='https://attacker.example/20221209.pdf'>WXF titles</a>")
    )

  test("downloaded official complete PDF parses without discarding any native player"):
    val path = sys.env.get("LIXIANGQI_WXF_TEST_PDF")
    assume(path.isDefined, "Set LIXIANGQI_WXF_TEST_PDF to verify the real official publication")
    val players = WxfRoster.fromPdf(java.nio.file.Files.readAllBytes(java.nio.file.Path.of(path.get)), source)
    assert(players.size > 300)
    assert(players.exists(_.id.value == "wxf:IGM0012"))
    assert(players.exists(_.id.value == "wxf:IFM0019"))
    assertEquals(players.map(_.id).distinct.size, players.size)
