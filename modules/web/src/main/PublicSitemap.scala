package lila.web

import lila.common.Sitemap.Entry

object PublicSitemap:
  // Curated, completed landing pages only. No arbitrary searches, game IDs, account pages or empty lessons.
  val core: List[Entry] =
    List("/", "/training/themes", "/training/notation", "/blog/community?filter=best").flatMap(localized) ++
      List(
        "/analysis",
        "/editor",
        "/games/database",
        "/players",
        "/learn/ancient-manuals",
        "/learn/special-rules",
        "/learn/xiangqi-rankings",
        "/variant",
        "/variant/jieqi",
        "/variant/minixiangqi",
        "/variant/manchu",
        "/variant/threeKingdoms",
        "/about",
        "/privacy",
        "/terms-of-service"
      ).map(Entry(_))

  // Static content has no trustworthy update timestamp; never use the build time as lastmod.
  def localized(path: String): List[Entry] =
    val suffix = if path == "/" then "" else path
    val alternatives =
      List("x-default" -> path, "en" -> s"/en$suffix", "zh-Hans" -> s"/zh$suffix", "vi" -> s"/vi$suffix")
    alternatives.map((_, url) => Entry(url, alternates = alternatives))
