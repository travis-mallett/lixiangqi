package lila.relay

import lila.study.StudyPgnTags

import lila.study.Chapter
import chess.format.pgn.Tags
import lila.tree.{ Branches, Node }

object RelayUpdatePlan:

  case class Input(chapters: List[Chapter], games: RelayGames):
    override def toString: String =
      s"Input(chapters = ${chapters.map(_.name)}, games = ${games.map(g => StudyPgnTags.names(g.tags))})"

  case class Plan(
      input: Input,
      reorder: Option[List[StudyChapterId]],
      update: List[(Chapter, RelayGame)],
      append: RelayGames,
      orphans: List[Chapter] // existing chapters that don't match any of the input games
  ):
    def validate: Either[String, Unit] =
      update
        .collectFirst:
          case (chapter, game)
              if chapter.root.children.nonEmpty &&
                (chapter.root.fen != game.root.fen || chapter.root.ruleset != game.root.ruleset) =>
            "Broadcast initial position or ruleset changed after moves were recorded"
          case (chapter, game)
              if chapter.root.children.countRecursive + addedNodes(
                chapter.root.children,
                game.root.children
              ) > Chapter.maxNodes =>
            s"Broadcast chapter ${chapter.name} would exceed ${Chapter.maxNodes} nodes; no games were imported"
        .orElse:
          append
            .find(_.root.children.countRecursive > Chapter.maxNodes)
            .map(_ => s"Broadcast chapter exceeds ${Chapter.maxNodes} nodes; no games were imported")
        .toLeft(())

    def isJustInitialChapterUpdate =
      input.chapters.sizeIs == 1 &&
        input.chapters.headOption.forall(_.isEmptyInitial) &&
        update.sizeIs == 1 && append.isEmpty && orphans.isEmpty

    override def toString: String =
      s"Output(reorder = $reorder, update = ${update.map(
          _._1.name
        )}, append = ${append.map(g => StudyPgnTags.names(g.tags))})"

  def apply(chapters: List[Chapter], games: RelayGames): Plan =
    apply(Input(chapters, games))

  private[relay] def addedNodes(existing: Branches, incoming: Branches): Int =
    incoming.toList
      .map: branch =>
        existing
          .get(branch.id)
          .fold(1 + branch.children.countRecursive)(node => addedNodes(node.children, branch.children))
      .sum

  def apply(input: Input): Plan =
    import input.*

    val likelyMatches: List[(RelayGame, Chapter)] =
      games
        .foldLeft(List.empty[(RelayGame, Chapter)]): (matches, game) =>
          chapters
            .collectFirst:
              case chapter if isSameGame(game, chapter) && !matches.exists(_._2 == chapter) =>
                game -> chapter
            .fold(matches)(_ :: matches)
        .reverse

    val replaceInitialChapter: Option[(RelayGame, Chapter)] =
      chapters match
        case List(only) if only.isEmptyInitial =>
          // likelyMatches should be empty
          games.headOption.map(_ -> only)
        case _ => none

    val updates: List[(Chapter, RelayGame)] = replaceInitialChapter match
      case Some(initial) => List(initial.swap)
      case None => likelyMatches.map(_.swap)

    val appends: Vector[RelayGame] = games.filterNot: g =>
      updates.exists(_._2 == g)

    // requires all chapters to be updated
    // contains all chapter ids
    val reorder: Option[List[StudyChapterId]] =
      val ids = updates.map(_._1.id)
      Option.when(ids.size == chapters.size && ids != chapters.map(_.id))(ids)

    val orphans: List[Chapter] =
      val updatedIds = updates.view.map(_._1.id).toSet
      chapters.filterNot(c => updatedIds.contains(c.id))

    Plan(
      input = input,
      reorder = reorder,
      update = updates,
      append = appends,
      orphans = orphans
    )

  private[relay] def isSameGame(game: RelayGame, chapter: Chapter): Boolean =
    isSameGameId(game.tags, chapter.tags).getOrElse:
      isSameGameBasedOnTags(game.tags, chapter.tags) || isSameGameBasedOnSomeTagsAndFirstMoves(game, chapter)

  private def isSameGameId(gameTags: Tags, chapterTags: Tags): Option[Boolean] =
    (gameTags(_.GameId), chapterTags(_.GameId)).mapN(_ == _)

  private[relay] def isSameGameBasedOnTags(gameTags: Tags, chapterTags: Tags): Boolean =
    allSame(RelayGame.eventTags)(gameTags, chapterTags) &&
      gameTags.roundNumber == chapterTags.roundNumber &&
      gameTags.boardNumber == chapterTags.boardNumber &&
      playerTagsMatch(gameTags, chapterTags)

  // if the board number or event has changed, but most moves look similar,
  // then probably it's the same game but the source changed the order and board numbers
  private[relay] def isSameGameBasedOnSomeTagsAndFirstMoves(game: RelayGame, chapter: Chapter): Boolean =
    game.tags.roundNumber == chapter.tags.roundNumber &&
      playerTagsMatch(game.tags, chapter.tags) && {
        val gameMoves = game.root.mainlineNodeList
        val chapterMoves = chapter.root.mainlineNodeList
        sameFirstMoves(gameMoves, chapterMoves)
      }

  private[relay] def sameFirstMoves(game: List[Node], chapter: List[Node]): Boolean =
    game.nonEmpty && chapter.nonEmpty && game.head.fen == chapter.head.fen &&
      game
        .zip(chapter)
        .forall: (left, right) =>
          left.moveOption.map(_.uci) == right.moveOption.map(_.uci)

  private def playerTagsMatch(gameTags: Tags, chapterTags: Tags): Boolean =
    val bothHavePlayerIds = List(gameTags, chapterTags).forall: ts =>
      RelayGame.playerIdTags.forall(side => ts(side).exists(_ != "0"))
    if bothHavePlayerIds
    then allSame(RelayGame.playerIdTags)(gameTags, chapterTags)
    else allSame(RelayGame.nameTags)(gameTags, chapterTags)

  private def allSame(tagNames: RelayGame.TagNames)(gameTags: Tags, chapterTags: Tags) = tagNames.forall:
    tag => gameTags(tag) == chapterTags(tag)
