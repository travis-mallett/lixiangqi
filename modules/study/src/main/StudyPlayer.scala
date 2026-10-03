package lila.study

import lila.xiangqi.Xiangqi.{ BySide, Side }
import chess.{ PlayerName, Centis, IntRating }
import lila.core.playerDirectory.{ PlayerId, PlayerTitle }
import chess.format.pgn.{ Tag, Tags }
import lila.core.playerDirectory.Federation

case class StudyPlayer(
    playerId: Option[PlayerId],
    title: Option[PlayerTitle],
    name: Option[PlayerName],
    rating: Option[IntRating],
    team: Option[String]
):
  def id: Option[StudyPlayer.Id] = playerId.map(_.value).orElse(name.map(_.value))

object StudyPlayer:

  case class WithFed(player: StudyPlayer, fed: Option[Federation.Id]):
    export player.*

  type Id = String

  object country:
    val tagNames = BySide("RedCountry", "BlackCountry")
    val tagTypes = tagNames.map(Tag.tagType)
    def feds(tags: Tags): BySide[Option[String]] =
      BySide(color => tags.apply(tagNames(color)))

  def fromTags(tags: Tags)(using guessFed: Federation.Guess): Option[BySide[StudyPlayer.WithFed]] =
    val names = StudyPgnTags.names(tags)
    Option.when(names.exists(_.isDefined)):
      val ratings = StudyPgnTags.ratings(tags).map(_.filter(_ > IntRating(0)))
      val players = BySide((side: Side) =>
        StudyPlayer(
          StudyPgnTags.playerIds(tags)(side),
          StudyPgnTags.titles(tags)(side),
          names(side),
          ratings(side),
          StudyPgnTags.teams(tags)(side)
        )
      )
      val feds = country.feds(tags).map(_.flatMap(guessFed))
      players.zip(feds).map(StudyPlayer.WithFed.apply)

  object json:
    import play.api.libs.json.*
    import lila.common.Json.given
    given studyPlayerWithFedWrites: OWrites[StudyPlayer.WithFed] =
      OWrites: p =>
        Json
          .obj("name" -> p.name)
          .add("title" -> p.title)
          .add("rating" -> p.rating)
          .add("playerId" -> p.playerId)
          .add("team" -> p.team)
          .add("fed" -> p.fed)
    given chapterPlayerWrites: OWrites[ChapterPlayer] = OWrites: p =>
      Json.toJsObject(p.studyPlayer).add("clock" -> p.clock)

case class ChapterPlayer(player: StudyPlayer, fed: Option[Federation.Id], clock: Option[Centis]):
  export player.*
  def studyPlayer = StudyPlayer.WithFed(player, fed)

object ChapterPlayer:

  def fromTags(tags: Tags, clocks: Chapter.BothClocks)(using
      Federation.Guess
  ): Option[BySide[ChapterPlayer]] =
    StudyPlayer
      .fromTags(tags)
      .map:
        _.zip(clocks).map: (player, clock) =>
          ChapterPlayer(player.player, fed = player.fed, clock)
