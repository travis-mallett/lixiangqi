package lila.relay

import lila.xiangqi.Xiangqi.{ BySide, Side, Score, GamePoints }
import lila.xiangqi.XiangqiJson.given
import lila.study.StudyPgnTags

import scala.collection.immutable.SeqMap
import play.api.libs.json.*
import scalalib.Debouncer
import chess.{ PlayerName, IntRating }
import lila.core.playerDirectory.RatingCategory
import lila.core.playerDirectory.PlayerId
import chess.rating.{ Elo, IntRatingDiff }
import chess.tiebreak.{ Tiebreak, TiebreakPoint }

import lila.study.StudyPlayer
import lila.study.StudyPlayer.json.given
import lila.memo.CacheApi
import lila.core.playerDirectory.{ PhotosJson, Federation, Player as DirectoryPlayer }
import lila.common.Json.given
import lila.relay.RelayGroup.ScoreGroup

// Player in a tournament with current performance rating and list of games
case class RelayPlayer(
    player: StudyPlayer.WithFed,
    ratingsMap: Map[RatingCategory, IntRating],
    score: Option[Float],
    ratingDiffs: Map[RatingCategory, IntRatingDiff],
    performances: Map[RatingCategory, IntRating],
    tiebreaks: Option[Seq[(Tiebreak, TiebreakPoint)]],
    rank: Option[RelayPlayer.Rank],
    games: Vector[RelayPlayer.Game]
):
  export player.player.*
  def withGame(game: RelayPlayer.Game, player: StudyPlayer.WithFed) =
    copy(
      games = games :+ game,
      ratingsMap = player.rating
        .ifFalse(ratingsMap.contains(game.ratingCategory))
        .fold(ratingsMap)(r => ratingsMap + (game.ratingCategory -> r))
    )
  def eloGames: Vector[Elo.Game] = games.flatMap(_.eloGame)
  def toTieBreakPlayer: Option[Tiebreak.Player] = player.id.map: id =>
    Tiebreak.Player(id = id.toString, rating = player.rating.map(_.into(Elo)))

object RelayPlayer:

  private[relay] def numericCategory(category: RatingCategory): chess.FideTC = category match
    case RatingCategory.standard => chess.FideTC.standard
    case RatingCategory.rapid => chess.FideTC.rapid
    case RatingCategory.blitz => chess.FideTC.blitz

  /* Sort players by:
      1. Score (Descending)
      2. Tiebreak points - compare each tiebreak in order,
          higher is better, except for Direct Encounter where lower (rank) is better
      3. Player rating (Descending)
      4. Player name (Alphabetical, ascending)
   */
  given Ordering[RelayPlayer] =
    import scala.math.Ordering.Implicits.seqOrdering
    given Ordering[(Tiebreak, TiebreakPoint)] = Ordering.by: (tb, tbv) =>
      if tb == chess.tiebreak.DirectEncounter then -tbv.value else tbv.value
    given Ordering[PlayerName] = Ordering.by[PlayerName, String](_.value).reverse
    Ordering.by: p =>
      (p.score, p.tiebreaks, p.player.rating.map(_.value), p.player.name)

  opaque type Rank = Int
  object Rank extends OpaqueInt[Rank]

  type RelayPlayers = SeqMap[StudyPlayer.Id, RelayPlayer]

  def empty(player: StudyPlayer.WithFed) =
    RelayPlayer(player, Map.empty, None, Map.empty, Map.empty, None, None, Vector.empty)

  case class Game(
      round: RelayRoundId,
      id: StudyChapterId,
      opponent: StudyPlayer.WithFed,
      color: Side,
      points: Option[GamePoints],
      rated: chess.Rated,
      ratingCategory: RatingCategory,
      customScoring: Option[BySide[RelayRound.CustomScoring]] = None,
      unplayed: Boolean,
      ongoing: Boolean
  ):
    def playerPoints = points.map(_(color))
    def customPlayerPoints: Option[RelayRound.CustomPoints] = customScoring.flatMap: cs =>
      playerPoints.map:
        case Score.One => cs(color).win
        case Score.Half => cs(color).draw
        case zero => RelayRound.CustomPoints(zero.value)

    def playerScore: Option[Float] =
      customPlayerPoints
        .map(_.value)
        .orElse(playerPoints.map(_.value))

    def toTiebreakGame: Option[Tiebreak.Game] =
      (opponent.id, playerPoints).mapN: (opponentId, points) =>
        Tiebreak.Game(
          color = chess.Color.fromWhite(color.red),
          opponent = Tiebreak.Player(opponentId.toString, opponent.rating.map(_.into(Elo))),
          points = externalPoints(points),
          roundId = round.value.some
        )

    // only rate draws and victories, not exotic results
    def isRated = rated.yes && !unplayed && points.exists(_.mapReduce(_.value)(_ + _) == 1)
    def eloGame = for
      pp <- playerPoints
      if isRated
      opRating <- opponent.rating
    yield Elo.Game(externalPoints(pp), opRating.into(Elo))

  // The inherited Elo/tiebreak library is a numeric algorithm boundary; native
  // participant identities and awarded scores never use its chess color types.
  private def externalPoints(score: Score): chess.Outcome.Points = score match
    case Score.Zero => chess.Outcome.Points.Zero
    case Score.Half => chess.Outcome.Points.Half
    case Score.One => chess.Outcome.Points.One

  object json:
    import scalalib.Json.writeAs
    given Writes[Score] = writeAs(_.show)
    given Writes[GamePoints] = writeAs(points => GamePoints.show(points.some))
    given Writes[RatingCategory] = writeAs(_.toString)
    given Writes[Seq[(Tiebreak, TiebreakPoint)]] = Writes: tbs =>
      Json.toJson:
        tbs.map: (tb, tbv) =>
          Json.obj(
            "extendedCode" -> tb.extendedCode,
            "description" -> tb.description,
            "points" -> tbv.value
          )
    given KeyWrites[RatingCategory] = _.toString // required by ratingDiffs & performances

    given OWrites[RelayPlayer] = OWrites: p =>
      Json.toJsObject(p.player) ++ Json
        .obj("played" -> p.games.count(_.points.isDefined))
        .add("score" -> p.score)
        .add("ratingsMap" -> p.ratingsMap.nonEmptyOption)
        .add("ratingDiffs" -> p.ratingDiffs.nonEmptyOption)
        .add("performances" -> p.performances.nonEmptyOption)
        .add("tiebreaks" -> p.tiebreaks)
        .add("rank" -> p.rank)
    def full(
        tour: RelayTour
    )(
        p: RelayPlayer,
        directoryPlayer: Option[DirectoryPlayer],
        user: Option[User],
        follow: Option[Boolean]
    ): JsObject =
      val eloPlayerByTCOpt = directoryPlayer
        .ifTrue(tour.showRatingDiffs)
        .map: fp =>
          p.ratingsMap.flatMap: (tc, tcRating) =>
            fp.kFactorOf(tc).map(k => tc -> Elo.Player(tcRating.into(Elo), k))
      val gamesJson = p.games.map: g =>
        val rd: Option[IntRatingDiff] = eloPlayerByTCOpt.flatMap: epByTC =>
          (epByTC.get(g.ratingCategory), g.eloGame).mapN: (ep, eg) =>
            Elo.computeRatingDiff(RelayPlayer.numericCategory(g.ratingCategory))(ep, List(eg))
        Json
          .obj(
            "round" -> g.round,
            "id" -> g.id,
            "opponent" -> g.opponent,
            "color" -> g.color,
            "ratingCategory" -> g.ratingCategory
          )
          .add("ongoing" -> g.ongoing)
          .add("points" -> g.playerPoints)
          .add("customPoints" -> g.customPlayerPoints)
          .add("ratingDiff" -> rd)
      Json
        .toJsObject(p)
        .add("user", user.map(_.light))
        .add("directory", directoryPlayer.map(Json.toJsObject).map(_.add("follow", follow))) ++
        Json.obj("games" -> gamesJson)
    given OWrites[DirectoryPlayer] = OWrites: p =>
      Json
        .obj(
          "year" -> p.year,
          "provenance" -> Json.obj(
            "provider" -> p.provenance.provider,
            "url" -> p.provenance.url,
            "publishedAt" -> p.provenance.publishedAt
          )
        )
        .add("ratings" -> p.ratingsMap.nonEmptyOption)

private final class RelayPlayerApi(
    tourRepo: RelayTourRepo,
    roundRepo: RelayRoundRepo,
    relayGroupApi: RelayGroupApi,
    chapterRepo: lila.study.ChapterRepo,
    cacheApi: CacheApi,
    directoryPlayerGet: lila.core.playerDirectory.GetPlayer,
    photosJson: PhotosJson.Get
)(using Federation.Guess, Executor)(using scheduler: Scheduler):
  import RelayPlayer.*

  private val cache = cacheApi[ScoreGroup, RelayPlayers](128, "relay.players.data"):
    _.expireAfterWrite(1.minute).buildAsyncFuture(computeScoreGroup)

  private val jsonCache = cacheApi[ScoreGroup, JsonStr](32, "relay.players.json"):
    _.expireAfterWrite(1.minute).buildAsyncFuture: sg =>
      import RelayPlayer.json.given
      for players <- cache.get(sg)
      yield JsonStr(Json.stringify(Json.toJson(players.values.toList)))

  def get(tourId: RelayTourId): Fu[RelayPlayers] =
    relayGroupApi.scoreGroupOf(tourId).flatMap(cache.get)

  def jsonList(tourId: RelayTourId): Fu[JsonStr] =
    relayGroupApi.scoreGroupOf(tourId).flatMap(jsonCache.get)

  private val photosJsonCache = cacheApi[RelayTourId, PhotosJson](256, "relay.players.photos.json"):
    _.expireAfterWrite(20.seconds).buildAsyncFuture: tourId =>
      for
        sg <- relayGroupApi.scoreGroupOf(tourId)
        studyIds <- sg.toList.flatTraverse(roundRepo.studyIdsOf)
        playerIds <- chapterRepo.playerIdsOf(studyIds)
        photos <- photosJson(playerIds)
      yield photos

  def photosJson(tourId: RelayTourId): Fu[PhotosJson] = photosJsonCache.get(tourId)

  def player(tour: RelayTour, str: String): Fu[Option[RelayPlayer]] =
    val id: StudyPlayer.Id = str
    for
      players <- get(tour.id)
      player = players.get(id)
    yield player

  def invalidate(id: RelayTourId) = invalidateDebouncer.push(id)

  private val invalidateDebouncer = Debouncer[RelayTourId](scheduler.scheduleOnce(3.seconds, _), 32): id =>
    import lila.memo.CacheApi.invalidate
    relayGroupApi
      .scoreGroupOf(id)
      .foreach: key =>
        cache.invalidate(key)
        jsonCache.invalidate(key)

  private def computeScoreGroup(sg: ScoreGroup): Fu[RelayPlayers] =
    // Use the first tour to retrieve display settings (scores, rating diffs, tiebreaks)
    tourRepo
      .byId(sg.head)
      .flatMapz: tour =>
        for
          players <- readGamesAndPlayers(sg.toList)
          atLeastOneGameFinished = players.exists(_._2.games.exists(_.points.isDefined))
          result <-
            if !atLeastOneGameFinished then fuccess(players)
            else
              val withScore = computeScoresAndPerformances(players, tour.showScores)
              for
                withRatingDiff <-
                  if tour.showRatingDiffs then computeRatingDiffs(withScore) else fuccess(withScore)
                withTiebreaks <- tour.tiebreaks.fold(fuccess(withRatingDiff)): tiebreaks =>
                  roundRepo
                    .idsByTourOrdered(sg.last)
                    .map(_.lastOption)
                    .map(computeTiebreaks(withRatingDiff, tiebreaks, _))
              yield withTiebreaks
          withRank = result.toList
            .sortByReverse(_._2)
            .mapWithIndex:
              case ((id, rp), index) =>
                id -> rp.copy(rank = Rank.from((index + 1).some))
            .to(SeqMap)
        yield withRank

  private def readGamesAndPlayers(tourIds: List[RelayTourId]): Fu[RelayPlayers] =
    for
      tours <- tourRepo.byIds(tourIds)
      toursById = tours.mapBy(_.id)
      rounds <-
        if RelayGroup.sgIsParallel(tours)
        then roundRepo.byToursOrdered(tourIds).map(_.sortBy(_.startsAtTime))
        else tourIds.flatTraverse(roundRepo.byTourOrdered)
      roundsById = rounds.mapBy(_.id)
      chapters <- chapterRepo.tagsByStudyIds(rounds.map(_.studyId))
      allPlayerIds = chapters
        .flatMap(_._2.flatMap((_, tags) => StudyPgnTags.playerIds(tags).flatten))
        .toList
        .distinct
      fedsById <- allPlayerIds
        .traverse(id => directoryPlayerGet(id).map(id -> _))
        .map(_.flatMap((id, playerOpt) => playerOpt.flatMap(_.fed).map(id -> _)).toMap)
    yield chapters.foldLeft(SeqMap.empty: RelayPlayers):
      case (playersAcc, (studyId, chaps)) =>
        roundsById
          .get(studyId.into(RelayRoundId))
          .fold(playersAcc): round =>
            chaps.foldLeft(playersAcc):
              case (playersAcc, (chapterId, tags)) =>
                StudyPlayer
                  .fromTags(tags)
                  .flatMap:
                    _.traverse: p =>
                      p.id.map(_ -> p.copy(fed = p.fed orElse p.playerId.flatMap(fedsById.get)))
                  .fold(playersAcc): gamePlayers =>
                    gamePlayers.zipSide.foldLeft(playersAcc):
                      case (playersAcc, (color, (playerId, player))) =>
                        val (_, opponent) = gamePlayers(!color)
                        val game = RelayPlayer.Game(
                          round.id,
                          chapterId,
                          opponent,
                          color,
                          tags("Result").flatMap(GamePoints.fromResult),
                          round.rated,
                          round.ratingCategoryOverride
                            .orElse(toursById.get(round.tourId).map(_.info.ratingCategoryOrGuess))
                            .getOrElse(RatingCategory.standard),
                          round.customScoring,
                          unplayed = tags.value.has(RelayGame.unplayedTag),
                          ongoing =
                            tags("Result").flatMap(GamePoints.fromResult).isEmpty && tags.exists(_.Result)
                        )
                        playersAcc.updated(
                          playerId,
                          playersAcc
                            .getOrElse(playerId, RelayPlayer.empty(player))
                            .withGame(game, player)
                        )

  private def computeScoresAndPerformances(players: RelayPlayers, computeScores: Boolean): RelayPlayers =
    players.view
      .mapValues: p =>
        p.copy(
          score = computeScores.so(p.games.foldMap(_.playerScore)),
          performances = p.games
            .groupBy(_.ratingCategory)
            .foldLeft(Map.empty):
              case (acc, (gameTC, tcGames)) =>
                val performanceRating = Elo.computePerformanceRating(tcGames.flatMap(_.eloGame))
                performanceRating.fold(acc)(r => acc + (gameTC -> r.into(IntRating)))
        )
      .to(SeqMap)

  private def computeRatingDiffs(players: RelayPlayers): Fu[RelayPlayers] =
    players.toList
      .traverse: (id, player) =>
        val eloGames = player.eloGames
        if eloGames.isEmpty then fuccess(id -> player)
        else
          player.playerId
            .so(directoryPlayerGet)
            .map: directoryPlayerOpt =>
              val newPlayer = directoryPlayerOpt.fold(player): directoryPlayer =>
                val newRatingDiffs = player.games
                  .groupBy(_.ratingCategory)
                  .foldLeft(Map.empty[RatingCategory, IntRatingDiff]):
                    case (diffs, (gameTC, tcGames)) =>
                      player.ratingsMap
                        .get(gameTC)
                        .map(_.into(Elo))
                        .orElse(directoryPlayer.ratingOf(gameTC))
                        .zip(directoryPlayer.kFactorOf(gameTC))
                        .fold(diffs): (rating, k) =>
                          val p = Elo.Player(rating, k)
                          val newDiff = Elo.computeRatingDiff(RelayPlayer.numericCategory(gameTC))(
                            p,
                            tcGames.flatMap(_.eloGame)
                          )
                          diffs + (gameTC -> newDiff)
                player.copy(ratingDiffs = newRatingDiffs)
              id -> newPlayer
      .map(_.to(SeqMap))

  private def computeTiebreaks(
      players: RelayPlayers,
      tiebreaks: Seq[Tiebreak],
      lastRoundId: Option[RelayRoundId]
  ): RelayPlayers =
    val tbGames: Map[String, Tiebreak.PlayerWithGames] =
      players.view.values
        .flatMap: p =>
          p.toTieBreakPlayer.map: tbPlayer =>
            tbPlayer.id -> Tiebreak.PlayerWithGames(tbPlayer, p.games.flatMap(_.toTiebreakGame))
        .toMap
    val result = Tiebreak.compute(tbGames, tiebreaks.toList, lastRoundId = lastRoundId.map(_.value))
    players
      .map: (id, rp) =>
        val found = result.find(p => p.player.id == id.toString)
        id -> rp.copy(
          tiebreaks = found.map(t => tiebreaks.zip(t.tiebreakPoints).to(Seq))
        )
      .to(SeqMap)
