package lila.relay

import lila.xiangqi.Xiangqi.{ BySide, Side }
import lila.study.StudyPgnTags
import lila.core.playerDirectory.{ Player, RatingCategory }
import chess.format.pgn.{ Tag, Tags }

final private class RelayDirectoryPlayerApi(guessPlayer: lila.core.playerDirectory.GuessPlayer)(using
    Executor
):

  def enrichGames(rwt: RelayRound.WithTour)(games: RelayGames): Fu[RelayGames] =
    games.traverse: game =>
      enrichTags(game.tags, rwt.ratingCategory).map(tags => game.copy(tags = tags))

  def enrichTags(tour: RelayTour): Tags => Fu[Tags] = enrichTags(_, tour.info.ratingCategoryOrGuess)

  private def enrichTags(tags: Tags, category: RatingCategory): Fu[Tags] =
    BySide((side: Side) =>
      if tags(side.fold("RedDirectoryLookup", "BlackDirectoryLookup")).contains("none") then fuccess(None)
      else
        guessPlayer(
          StudyPgnTags.playerIds(tags)(side),
          StudyPgnTags.names(tags)(side),
          StudyPgnTags.titles(tags)(side)
        )
    ).traverse(identity).map(update(tags, category, _))

  private def update(tags: Tags, category: RatingCategory, players: BySide[Option[Player]]): Tags =
    Side.values.toList.foldLeft(tags): (current, side) =>
      val fromDirectory = Tags(players(side).toList.flatMap: player =>
        val prefix = side.fold("Red", "Black")
        List(
          Some(Tag(s"${prefix}PlayerId", player.id.value)),
          Some(Tag(prefix, player.name.value)),
          player.title.map(title => Tag(s"${prefix}Title", title.value)),
          player.ratingOf(category).map(rating => Tag(s"${prefix}Elo", rating.toString)),
          player.fed.map(fed => Tag(s"${prefix}Country", fed.value)),
          Some(Tag(s"${prefix}PlayerSource", player.provenance.url)),
          Some(Tag(s"${prefix}PlayerSourceDate", player.provenance.publishedAt))
        ).flatten)
      // Source headers and explicit broadcaster overrides take precedence.
      fromDirectory ++ current.map(_.filterNot(tag => tag.value == "-"))
