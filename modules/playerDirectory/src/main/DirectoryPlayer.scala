package lila.playerDirectory

import chess.PlayerName
import lila.core.playerDirectory.PlayerTitle
import lila.core.playerDirectory.RatingCategory
import lila.core.playerDirectory.PlayerId
import chess.rating.{ Elo, KFactor }
import reactivemongo.api.bson.Macros.Annotations.Key

import java.text.Normalizer

import lila.core.playerDirectory.{ PlayerToken, Tokenize, diacritics }
import lila.core.id.ImageId

case class DirectoryPlayer(
    @Key("_id") id: PlayerId,
    name: PlayerName,
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
    inactive: Boolean
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

  def isSame(other: DirectoryPlayer) = sourceData == other.sourceData

  private def sourceData =
    (
      name,
      aliases,
      provenance,
      ratingSources,
      fed,
      title,
      standard,
      standardK,
      rapid,
      rapidK,
      blitz,
      blitzK,
      year,
      gender,
      inactive
    )

  def ratingsStr = List(
    "Standard" -> standard,
    "Rapid" -> rapid,
    "Blitz" -> blitz
  ).map: (name, rating) =>
    s"$name: ${rating.fold("—")(_.toString)}"
  .mkString(", ")

object DirectoryPlayer:

  case class PlayerPhoto(id: ImageId, credit: Option[String] = None)

  object PlayerPhoto:
    enum Size(val width: Int):
      def height = width
      def dimensions = lila.memo.Dimensions(width, height)
      case Medium extends Size(500)
      case Small extends Size(100)
    type SizeSelector = Size.type => Size

    def apply(picfitUrl: lila.memo.PicfitUrl, image: ImageId, size: SizeSelector): Url =
      picfitUrl.thumbnail(image)(size(Size).dimensions)

  object form:
    import play.api.data.*
    import play.api.data.Forms.*
    def credit(p: DirectoryPlayer) =
      Form(single("photo.credit" -> optional(nonEmptyText))).fill(p.photo.flatMap(_.credit))

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
