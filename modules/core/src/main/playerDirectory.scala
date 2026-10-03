package lila.core
package playerDirectory

import _root_.chess.PlayerName
import _root_.chess.rating.{ Elo, KFactor }
import play.api.libs.json.JsObject
import lila.core.userId.UserId

opaque type PlayerId = String
object PlayerId extends OpaqueString[PlayerId]:
  private val pattern = "[a-z][a-z0-9-]{1,15}:[A-Za-z0-9._-]{1,80}".r
  def parse(value: String): Option[PlayerId] = Option.when(pattern.matches(value))(apply(value))

opaque type PlayerTitle = String
object PlayerTitle extends OpaqueString[PlayerTitle]:
  val acronyms = List("IGM", "IM", "IFM", "GM", "NM")
  def get(value: String): Option[PlayerTitle] =
    val normalized = value.trim.toUpperCase(java.util.Locale.ROOT)
    Option.when(acronyms.contains(normalized))(apply(normalized))

enum RatingCategory:
  case standard, rapid, blitz
  def key = toString

object Federation:
  opaque type Id = String
  object Id extends OpaqueString[Id]
  type Name = String
  type ByPlayerIds = Map[PlayerId, Id]
  type FedsOf = List[PlayerId] => Fu[ByPlayerIds]
  type Guess = String => Option[Id]
  type GetName = Id => Fu[Option[Name]]
  case class Stats(rank: Int, nbPlayers: Int, top10Rating: Int)

/** Every directory fact identifies its publisher and publication date. Ratings from different publishers are
  * never merged by a player's name.
  */
case class Provenance(provider: String, url: String, publishedAt: String)

trait Player:
  def id: PlayerId
  def name: PlayerName
  def fed: Option[Federation.Id]
  def title: Option[PlayerTitle]
  def year: Option[Int]
  def provenance: Provenance
  def ratingOf(tc: RatingCategory): Option[Elo]
  def kFactorOf(tc: RatingCategory): Option[KFactor]
  def ratingsMap: Map[RatingCategory, Elo]

type PlayerToken = String
type GuessPlayer = (Option[PlayerId], Option[PlayerName], Option[PlayerTitle]) => Fu[Option[Player]]
type GetPlayer = PlayerId => Fu[Option[Player]]
type GetPlayerFollowers = PlayerId => Fu[Set[UserId]]

opaque type PhotosJson = JsObject
object PhotosJson extends TotalWrapper[PhotosJson, JsObject]:
  type Get = Set[PlayerId] => Fu[PhotosJson]

opaque type Tokenize = String => PlayerToken
object Tokenize extends FunctionWrapper[Tokenize, String => PlayerToken]

enum DirectoryPlayerOrder:
  case name, standard, rapid, blitz, year, follow
  def key = toString

object DirectoryPlayerOrder:
  def all: List[DirectoryPlayerOrder] = values.toList
  val byKey = values.mapBy(_.key)
  val default: DirectoryPlayerOrder = name

object diacritics:
  private val replacements = List("ö" -> "oe", "ø" -> "o", "å" -> "aa", "ä" -> "ae", "ü" -> "ue", "ß" -> "ss")
  def remove(name: String): String = replacements.foldLeft(name):
    case (text, (from, to)) => text.replace(from, to)
