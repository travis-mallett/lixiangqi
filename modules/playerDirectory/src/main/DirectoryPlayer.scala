package lila.playerDirectory

import chess.PlayerName
import lila.core.playerDirectory.PlayerTitle
import lila.core.playerDirectory.RatingCategory
import lila.core.playerDirectory.PlayerId
import chess.rating.{ Elo, KFactor }

import java.text.Normalizer

import lila.core.playerDirectory.{ PlayerToken, Tokenize, diacritics }
import lila.core.id.ImageId

case class DirectoryPlayer(
    id: PlayerId,
    name: PlayerName,
    displayName: PlayerName,
    token: PlayerToken,
    aliases: List[PlayerName],
    tokens: List[PlayerToken],
    provenance: lila.core.playerDirectory.Provenance,
    ratingSources: Map[String, lila.core.playerDirectory.Provenance],
    photo: Option[DirectoryPlayer.PlayerPhoto],
    fed: Option[lila.core.playerDirectory.Federation.Id],
    title: Option[PlayerTitle],
    standard: Option[Elo],
    standardK: Option[KFactor],
    rapid: Option[Elo],
    rapidK: Option[KFactor],
    blitz: Option[Elo],
    blitzK: Option[KFactor],
    year: Option[Int],
    deceasedYear: Option[Int] = None,
    gender: Option[DirectoryPlayer.Gender] = None,
    inactive: Boolean,
    biography: Map[String, String] = Map.empty,
    biographySources: List[String] = Nil,
    team: Option[String] = None,
    teamAsOf: Option[String] = None,
    stats: DirectoryPlayer.GameStats = DirectoryPlayer.GameStats(),
    titles: List[DirectoryPlayer.RecordedTitle] = Nil
) extends lila.core.playerDirectory.Player:

  def ratingOf(tc: RatingCategory): Option[Elo] = tc match
    case RatingCategory.standard => standard
    case RatingCategory.rapid => rapid
    case RatingCategory.blitz => blitz

  def kFactorOf(tc: RatingCategory): Option[KFactor] = tc match
    case RatingCategory.standard => standardK
    case RatingCategory.rapid => rapidK
    case RatingCategory.blitz => blitzK

  require(
    RatingCategory.values.forall(tc => ratingOf(tc).isEmpty || ratingSources.contains(tc.key)),
    "Directory ratings require explicit publication provenance"
  )

  lazy val slug: String = DirectoryPlayer.slugify(name)

  def age: Option[Int] =
    val nowYear = nowInstant.date.getYear
    year.map: birthYear =>
      deceasedYear.fold(nowYear - birthYear)(deceasedYear => deceasedYear - birthYear)

  def ratingsMap: Map[RatingCategory, Elo] =
    RatingCategory.values.flatMap(tc => ratingOf(tc).map(tc -> _)).toMap

  def ratingsStr = List(
    "Standard" -> standard,
    "Rapid" -> rapid,
    "Blitz" -> blitz
  ).map: (name, rating) =>
    s"$name: ${rating.fold("—")(_.toString)}"
  .mkString(", ")

object DirectoryPlayer:

  case class RecordedTitle(
      issuer: String,
      code: String,
      status: String,
      source: lila.core.playerDirectory.Provenance,
      statusSource: Option[lila.core.playerDirectory.Provenance]
  )

  case class GameStats(
      games: Int = 0,
      wins: Int = 0,
      draws: Int = 0,
      losses: Int = 0,
      lastPlayedAt: Option[String] = None,
      team: Option[String] = None,
      teamAsOf: Option[String] = None
  )

  case class PlayerPhoto(
      id: ImageId,
      credit: Option[String] = None,
      url: Option[String] = None,
      sourceUrl: Option[String] = None,
      license: Option[String] = None,
      licenseUrl: Option[String] = None
  )

  object PlayerPhoto:
    enum Size(val width: Int):
      def height = width
      def dimensions = lila.memo.Dimensions(width, height)
      case Medium extends Size(500)
      case Small extends Size(100)
    type SizeSelector = Size.type => Size

    def apply(picfitUrl: lila.memo.PicfitUrl, image: ImageId, size: SizeSelector): Url =
      picfitUrl.thumbnail(image)(size(Size).dimensions)

    def apply(picfitUrl: lila.memo.PicfitUrl, photo: PlayerPhoto, size: SizeSelector): Url =
      photo.url.map(Url(_)).getOrElse(apply(picfitUrl, photo.id, size))

  object form:
    import play.api.data.*
    import play.api.data.Forms.*
    case class Edit(credit: Option[String], biography: Option[String], sources: Option[String])
    def edit(p: DirectoryPlayer, language: String) =
      val fields = mapping(
        "photo.credit" -> optional(text(maxLength = 500)),
        "biography" -> optional(text(maxLength = 6000)),
        "sources" -> optional(text(maxLength = 4000))
      )(Edit.apply)(e => Some((e.credit, e.biography, e.sources)))
        .verifying(
          "A biography requires HTTP source URLs",
          e =>
            val urls = e.sources.toList.flatMap(_.linesIterator.map(_.trim).filter(_.nonEmpty))
            (urls.nonEmpty || (e.biography.isEmpty && (p.biography - language).isEmpty)) &&
            urls.forall(u =>
              scala.util
                .Try(java.net.URI(u))
                .toOption
                .exists(uri =>
                  Set("https", "http")
                    .contains(uri.getScheme) && uri.getHost != null && uri.getUserInfo == null
                )
            )
        )
        .verifying(
          "External portraits require a credit",
          e => !p.photo.exists(_.url.isDefined) || e.credit.exists(_.trim.nonEmpty)
        )
      Form(fields).fill(
        Edit(
          p.photo.flatMap(_.credit),
          p.biography.get(language),
          Option.when(p.biographySources.nonEmpty)(p.biographySources.mkString("\n"))
        )
      )

  case class WithFollow(player: DirectoryPlayer, follow: Boolean)

  opaque type Gender = Char
  object Gender extends TotalWrapper[Gender, Char]

  private[playerDirectory] val tokenize: Tokenize = Tokenize:
    val nonLetterRegex = """[^\p{L}\p{N}\s]+""".r
    val splitRegex = """\s+""".r
    str =>
      splitRegex
        .split:
          Normalizer
            .normalize(diacritics.remove(str.trim), Normalizer.Form.NFD)
            .replaceAllIn(nonLetterRegex, "")
            .toLowerCase(java.util.Locale.ROOT)
        .toList
        .map(_.trim)
        .filter(_.nonEmpty)
        .pipe(trimTitle)
        .distinct
        .sorted
        .mkString(" ")

  private def trimTitle(name: List[String]): List[String] = name match
    case title :: rest if PlayerTitle.get(title).isDefined => rest
    case _ => name

  private[playerDirectory] val slugify: PlayerName => String =
    val splitAccentRegex = "[\u0300-\u036f]".r
    val multiSpaceRegex = """\s+""".r
    val badChars = """[^\p{L}\p{N}_\-]+""".r
    name =>
      badChars.replaceAllIn(
        multiSpaceRegex.replaceAllIn(
          splitAccentRegex.replaceAllIn(
            // split an accented letter in the base letter and the accent
            Normalizer.normalize(name.value, Normalizer.Form.NFD),
            ""
          ),
          "_"
        ),
        ""
      )
