package lila.playerDirectory

import chess.PlayerName
import lila.core.playerDirectory.{ Federation as CoreFederation, PlayerId, PlayerTitle, Provenance }

/** The WXF publishes a titled-player roster, not a numerical rating list. */
private[playerDirectory] object WxfRoster:
  val pageUrl =
    "https://www.wxf-xiangqi.org/index.php?Itemid=320&id=223&lang=en&option=com_content&view=article"

  def publication(html: String): (String, String) =
    import scala.jdk.CollectionConverters.*
    val urls = org.jsoup.Jsoup
      .parse(html, pageUrl)
      .select("a[href]")
      .asScala
      .map(_.absUrl("href"))
      .filter: url =>
        val uri = java.net.URI(url)
        uri.getScheme == "https" && uri.getHost == "www.wxf-xiangqi.org" &&
        uri.getPath.startsWith("/images/Player_Titled_List/") && uri.getPath.endsWith(".pdf")
      .distinct
      .toList
    require(urls.size == 1, s"Expected one official WXF roster, found ${urls.size}")
    val url = urls.head
    val date = "(20[0-9]{6})".r
      .findFirstIn(java.net.URI(url).getPath)
      .map(java.time.LocalDate.parse(_, java.time.format.DateTimeFormatter.BASIC_ISO_DATE))
      .getOrElse(throw IllegalArgumentException("WXF roster has no publication date"))
    (url, date.toString)

  def fromPdf(bytes: Array[Byte], provenance: Provenance): List[DirectoryPlayer] =
    val document = org.apache.pdfbox.Loader.loadPDF(bytes)
    try
      require(document.getNumberOfPages <= 100, "WXF roster exceeds 100 pages")
      val text = org.apache.pdfbox.text.PDFTextStripper().getText(document)
      parse(text, provenance)
    finally document.close()

  private val entry = "(?m)^(IGM|IFM|IM)([0-9]{4})\\s+".r
  private val details = "(?s)^(.+?)\\s+[男女]\\s+(Male|Female)\\s+(.+)$".r
  private val names = "^([^A-Za-z]+?)\\s*([A-Za-z].*)$".r
  private val countries = List(
    "The United States of America" -> "USA",
    "Hong Kong, China" -> "HKG",
    "Chinese Taipei" -> "TPE",
    "The Netherlands" -> "NED",
    "The Philippines" -> "PHI",
    "Macau, China" -> "MAC",
    "Great Britain" -> "GBR",
    "Singapore" -> "SGP",
    "Australia" -> "AUS",
    "Indonesia" -> "INA",
    "Malaysia" -> "MAS",
    "Cambodia" -> "CAM",
    "Thailand" -> "THA",
    "Vietnam" -> "VIE",
    "Germany" -> "GER",
    "Finland" -> "FIN",
    "Sweden" -> "SWE",
    "Belarus" -> "BLR",
    "Myanmar" -> "MYA",
    "Brunei" -> "BRU",
    "Canada" -> "CAN",
    "France" -> "FRA",
    "Italy" -> "ITA",
    "Spain" -> "ESP",
    "Japan" -> "JPN",
    "China" -> "CHN",
    "Russia" -> "RUS",
    "Poland" -> "POL",
    "Denmark" -> "DEN",
    "Austria" -> "AUT",
    "Switzerland" -> "SUI",
    "Belgium" -> "BEL"
  ).sortBy((name, _) => -name.length)

  def parse(text: String, provenance: Provenance): List[DirectoryPlayer] =
    require(provenance.provider == "wxf", "Unexpected WXF publication provider")
    val entries = entry.findAllMatchIn(text).toList
    require(entries.nonEmpty && entries.size <= 10000, "WXF roster is empty or exceeds its player limit")
    require(
      "(?m)^\\s*(?:IGM|IFM|IM)".r.findAllMatchIn(text).size == entries.size,
      "Malformed WXF player identifier"
    )
    val players = entries.zipWithIndex.map: (matched, index) =>
      val id = PlayerId.parse(s"wxf:${matched.group(1)}${matched.group(2)}").get
      val content = text
        .substring(matched.end, entries.lift(index + 1).fold(text.length)(_.start))
        .replaceAll("\\s+", " ")
        .trim
      val (beforeGender, gender, titleText) = content match
        case details(name, gender, title) => (name, gender, title)
        case _ => throw IllegalArgumentException(s"Malformed WXF row $id")
      val title = matched.group(1)
      val expectedTitle = title match
        case "IGM" => "International Grandmaster"
        case "IM" => "International Master"
        case "IFM" => "Federation Master"
      require(titleText.contains(expectedTitle), s"Inconsistent title for $id")
      val countryAndName = beforeGender.dropWhile(c => !c.isLetter || c > 127)
      val (country, code) = countries
        .find((country, _) => countryAndName.startsWith(country + " "))
        .getOrElse(throw IllegalArgumentException(s"Unknown WXF country in $id"))
      val (nativeName, romanName) = countryAndName.drop(country.length).trim match
        case names(native, roman) => (native.trim, roman.trim)
        case _ => throw IllegalArgumentException(s"Missing bilingual WXF player name for $id")
      val aliases = List(PlayerName(nativeName))
      val name = PlayerName(romanName)
      val token = DirectoryPlayer.tokenize.exec(name.value)
      DirectoryPlayer(
        id = id,
        name = name,
        token = token,
        aliases = aliases,
        tokens = (name :: aliases).map(n => DirectoryPlayer.tokenize.exec(n.value)).distinct,
        provenance = provenance,
        ratingSources = Map.empty,
        photo = None,
        fed = Some(CoreFederation.Id(code)),
        title = PlayerTitle.get(title),
        standard = None,
        standardK = None,
        rapid = None,
        rapidK = None,
        blitz = None,
        blitzK = None,
        year = None,
        gender = Some(DirectoryPlayer.Gender(if gender == "Male" then 'M' else 'F')),
        inactive = false
      )
    require(players.map(_.id).distinct.size == players.size, "Duplicate WXF player identity")
    players
