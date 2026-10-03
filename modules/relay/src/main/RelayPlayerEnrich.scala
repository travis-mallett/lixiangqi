package lila.relay

import lila.xiangqi.Xiangqi.Side
import lila.study.StudyPgnTags

import chess.format.pgn.{ Tag, Tags }
import chess.{ PlayerName, IntRating }
import lila.core.playerDirectory.PlayerTitle
import lila.core.playerDirectory.PlayerId

import lila.core.socket.Sri
import lila.core.playerDirectory.{ PlayerToken, Federation, diacritics }
import lila.study.{ Chapter, ChapterRepo, StudyApi, StudyPlayer }

// used to change names and ratings of broadcast players
private case class RelayPlayerLine(
    name: Option[PlayerName],
    rating: Option[IntRating],
    title: Option[PlayerTitle],
    playerId: Option[PlayerId] = none,
    playerFederation: Option[String] = none, // checked against the country directory when applied
    directoryLookup: Boolean = true
)

private object RelayPlayerLine:

  object tokenize:
    private val nonLetterRegex = """[^\p{L}\p{N}\s]+""".r
    private val splitRegex = """\s+""".r
    private val titleRegex = """(?i)(dr|prof)\.""".r
    private val playerTitleRegex =
      s"""^(${lila.core.playerDirectory.PlayerTitle.acronyms.mkString("|")} )""".r
    def apply(str: String): PlayerToken =
      val trimmed = str.trim.replaceAllIn(playerTitleRegex, "").trim
      splitRegex
        .split:
          java.text.Normalizer
            .normalize(trimmed, java.text.Normalizer.Form.NFD)
            .replace(",", " ")
            .replaceAllIn(titleRegex, "")
            .replaceAllIn(nonLetterRegex, "")
            .toLowerCase(java.util.Locale.ROOT)
        .toList
        .map(_.trim)
        .filter(_.nonEmpty)
        .distinct
        .sorted
        .mkString(" ")

  case class Ambiguous(name: PlayerName, players: List[RelayPlayerLine])

private case class RelayPlayersTextarea(text: String):

  def sortedText = text.linesIterator.toList.sorted.mkString("\n")

  lazy val validation: Either[String, RelayPlayerLines] =
    val lines = text.linesIterator.map(_.trim).filter(_.nonEmpty).toList
    if lines.size > 1000 then Left("Player overrides exceed 1000 lines")
    else
      lines.zipWithIndex
        .traverse: (line, index) =>
          val arr = line.split("/", -1).map(_.trim)
          def field(at: Int) = arr.lift(at).filter(_.nonEmpty)
          def error(message: String) = Left(s"Player override line ${index + 1}: $message")
          if arr.length > 6 || field(0).isEmpty then
            error("expected name / player ID / title / rating / replacement name / federation")
          else if field(1).exists(v => v != "-" && PlayerId.parse(v).isEmpty) then
            error("invalid namespaced native player ID")
          else if field(2).exists(PlayerTitle.get(_).isEmpty) then error("invalid Xiangqi title")
          else if field(3).exists(v => !v.toIntOption.exists(n => n >= 0 && n <= 4000)) then
            error("invalid rating")
          else
            Right(
              PlayerName(arr(0)) -> RelayPlayerLine(
                name = PlayerName.from(field(4)),
                rating = IntRating.from(field(3).flatMap(_.toIntOption)),
                title = field(2).flatMap(PlayerTitle.get),
                playerId = field(1).flatMap(PlayerId.parse),
                playerFederation = field(5),
                directoryLookup = !field(1).contains("-")
              )
            )
        .flatMap: parsed =>
          if parsed.map(_._1).distinct.size != parsed.size then
            Left("Player overrides contain duplicate names")
          else Right(RelayPlayerLines(parsed.toMap))

  lazy val parse: RelayPlayerLines =
    validation.fold(message => throw IllegalArgumentException(message), identity)

private case class RelayPlayerLines(players: Map[PlayerName, RelayPlayerLine]):

  import RelayPlayerLine.tokenize

  def diff(prev: Option[RelayPlayerLines]): Option[RelayPlayerLines] =
    val prevPlayers = prev.so(_.players)
    val newPlayers =
      players.view
        .filter: (name, player) =>
          prevPlayers.get(name).forall(_ != player)
    newPlayers.nonEmpty.option(RelayPlayerLines(newPlayers.toMap))

  // With tokenized player names
  private lazy val tokenizedPlayers: Map[PlayerToken, RelayPlayerLine] =
    umlautifyPlayers(players).mapKeys(name => tokenize(name.value))

  // duplicated PlayerName with it's umlautified version
  private def umlautifyPlayers(players: Map[PlayerName, RelayPlayerLine]): Map[PlayerName, RelayPlayerLine] =
    players.foldLeft(players):
      case (map, (name, player)) =>
        map + (name.map(diacritics.remove) -> player)

  // With player names combinations.
  // For example, if the tokenized player name is "A B C D", the combinations will be:
  // A B, A C, A D, B C, B D, C D, A B C, A B D, A C D, B C D
  private lazy val combinationPlayers: Map[PlayerToken, List[RelayPlayerLine]] =
    val combinations = for
      (fullToken, player) <- tokenizedPlayers.toList
      words = fullToken.split(' ').filter(_.sizeIs > 1).toList
      size <- 2 to words.length.atMost(4)
      combination <- words.combinations(size)
    yield combination.mkString(" ") -> player
    combinations
      .foldLeft(Map.empty[PlayerToken, List[RelayPlayerLine]]):
        case (acc, (token, player)) =>
          acc + (token -> (player :: acc.getOrElse(token, Nil)))
      .view
      .mapValues(_.distinct)
      .toMap

  def update(games: RelayGames)(using Federation.Guess): (RelayGames, List[RelayPlayerLine.Ambiguous]) =
    games.foldLeft(Vector.empty -> Nil):
      case ((games, ambiguous), game) =>
        val (tags, ambi) = update(game.tags)
        (games :+ game.copy(tags = tags)) -> (ambi ::: ambiguous)

  def update(tags: Tags)(using guessFed: Federation.Guess): (Tags, List[RelayPlayerLine.Ambiguous]) =
    Side.values.toList.foldLeft(tags -> Nil):
      case ((tags, ambiguous), color) =>
        val name = StudyPgnTags.names(tags)(color)
        val matching = name.fold(Matching.NotFound)(findMatching)
        val newTags = tags ++ Tags:
          matching.match
            case Matching.Found(rp) =>
              List(
                rp.playerId.map(id => Tag(color.fold("RedPlayerId", "BlackPlayerId"), id.value)),
                Option.when(!rp.directoryLookup)(
                  Tag(color.fold("RedDirectoryLookup", "BlackDirectoryLookup"), "none")
                ),
                rp.name.map(name => Tag(color.fold("Red", "Black"), name)),
                rp.rating.map(rating => Tag(color.fold("RedElo", "BlackElo"), rating.toString)),
                rp.title.map(title => Tag(color.fold("RedTitle", "BlackTitle"), title.value)),
                rp.playerFederation
                  .flatMap(guessFed)
                  .map(fed => Tag(StudyPlayer.country.tagNames(color), fed.value))
              ).flatten
            case _ => Nil
        val newAmbiguous = matching match
          case Matching.Ambiguous(players) =>
            name.fold(ambiguous): name =>
              RelayPlayerLine.Ambiguous(name, players) :: ambiguous
          case _ => ambiguous
        (newTags, newAmbiguous)

  enum Matching:
    case Found(player: RelayPlayerLine)
    case NotFound
    case Ambiguous(players: List[RelayPlayerLine])

  private def findMatching(name: PlayerName): Matching =
    players
      .get(name)
      .map(Matching.Found.apply)
      .orElse:
        val token = tokenize(name.value)
        tokenizedPlayers
          .get(token)
          .map(Matching.Found.apply)
          .orElse:
            combinationPlayers
              .get(token)
              .map:
                case single :: Nil => Matching.Found(single)
                case multi => Matching.Ambiguous(multi)
      .getOrElse(Matching.NotFound)

private final class RelayPlayerEnrich(
    irc: lila.core.irc.IrcApi,
    roundRepo: RelayRoundRepo,
    directoryPlayerApi: RelayDirectoryPlayerApi,
    studyApi: StudyApi,
    chapterRepo: ChapterRepo
)(using Federation.Guess, Executor, org.apache.pekko.stream.Materializer):

  private val once = scalalib.cache.OnceEvery.hashCode[List[RelayPlayerLine.Ambiguous]](1.hour)

  def enrichAndReportAmbiguous(rt: RelayRound.WithTour)(games: RelayGames): RelayGames =
    rt.tour.players.fold(games): txt =>
      val (updated, ambiguous) = txt.parse.update(games)
      if ambiguous.nonEmpty && rt.tour.official && once(ambiguous) then
        def show(p: RelayPlayerLine): String = p.playerId.map(_.toString) | p.name.fold("?")(_.value)
        val players = ambiguous.map: a =>
          (a.name.value, a.players.map(show))
        irc.broadcastAmbiguousPlayers(rt.round.id, rt.fullNameNoTrans, players)
      updated

  /* When the players replacement text of a tournament is updated,
   * we go through all rounds of the tournament and immediately apply
   * the player replacements to all games.
   * Then we enrich all affected games based on the potentially new native player ID
   * of each player. */
  def onPlayerTextareaUpdate(tour: RelayTour, prev: RelayTour): Funit =
    tour.players.so:
      _.parse
        .diff(prev.players.map(_.parse))
        .so: newPlayers =>
          val enrichFromPlayerId = directoryPlayerApi.enrichTags(tour)
          for
            studyIds <- roundRepo.studyIdsOf(tour.id)
            _ <- chapterRepo
              .byStudiesSource(studyIds)
              .mapAsync(1): chapter =>
                val (newTags, _) = newPlayers.update(chapter.tags)
                (newTags != chapter.tags).so:
                  enrichFromPlayerId(newTags)
                    .flatMap: enriched =>
                      val forcedReplacements = newTags.map(_.filterNot(enriched.value.contains))
                      val finalTags = enriched ++ forcedReplacements
                      val newName = Chapter.nameFromPlayerTags(finalTags)
                      studyApi.setTagsAndRename(
                        studyId = chapter.studyId,
                        chapterId = chapter.id,
                        tags = finalTags,
                        newName = newName.filter(_ != chapter.name)
                      )(lila.study.Who(chapter.ownerId, Sri("")))
              .run()
          yield ()
