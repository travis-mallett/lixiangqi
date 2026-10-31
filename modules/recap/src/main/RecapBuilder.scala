package lila.recap

import reactivemongo.pekkostream.cursorProducer
import reactivemongo.api.bson.BSONNull

import lila.db.dsl.{ *, given }
import lila.game.Query
import lila.core.game.Source
import lila.mon.extensions.*

private final class RecapBuilder(
    repo: RecapRepo,
    gameRepo: lila.game.GameRepo,
    kingdomsRepo: lila.threeKingdoms.GameRepo,
    puzzleColls: lila.puzzle.PuzzleColls
)(using Executor, org.apache.pekko.stream.Materializer):

  def compute(userId: UserId): Funit = for
    recap <- (
      runGameScan(userId)
        .flatMap(scan =>
          kingdomsRepo
            .exportUser(userId, Some(dateStart), Some(dateEnd))
            .filter(_.position.finished)
            .runFold(scan)((s, g) => s.addKingdoms(userId, g))
        )
        .map(makeGameRecap),
      runPuzzleScan(userId).map(_ | RecapPuzzles())
    ).mapN: (game, puzzle) =>
      Recap(userId, Recap.schemaVersion, yearToRecap, game, puzzle, nowInstant)
    _ <- repo.insert(recap)
  yield ()

  private def runPuzzleScan(userId: UserId): Fu[Option[RecapPuzzles]] =
    puzzleColls.round:
      _.aggregateOne() { framework =>
        import framework.*
        Match($doc("u" -> userId, "d" -> $doc("$gt" -> dateStart, "$lt" -> dateEnd))) -> List(
          Group(BSONNull)(
            "nb" -> SumAll,
            "wins" -> Sum($doc("$cond" -> $arr("$w", 1, 0))),
            "fixes" -> Sum($doc("$cond" -> $arr($doc("$and" -> $arr("$w", "$f")), 1, 0))),
            "votes" -> Sum($doc("$cond" -> $arr("$v", 1, 0))),
            "themes" -> Sum($doc("$cond" -> $arr("$t", 1, 0)))
          )
        )
      }.map: r =>
        for
          doc <- r
          nb <- doc.int("nb")
          wins <- doc.int("wins")
          fixes <- doc.int("fixes")
          votes <- doc.int("votes")
          themes <- doc.int("themes")
        yield RecapPuzzles(
          nbs = NbWin(total = nb, win = wins - fixes),
          votes = PuzzleVotes(nb = votes, themes = themes)
        )
      .monSuccess(lila.mon.recap.puzzles)

  private def makeGameRecap(scan: GameScan): RecapGames =
    RecapGames(
      nbs = scan.nbs,
      nbRed = scan.nbRed,
      moves = scan.nbMoves,
      firstRedMoves = scan.firstRedMoves.toList.sortBy(-_._2).take(5).map(Recap.Counted.apply),
      timePlaying = scan.secondsPlaying.seconds,
      sources = scan.sources,
      opponents = scan.opponents.toList.sortBy(-_._2).take(5).map(Recap.Counted.apply),
      perfs = scan.perfs.toList.sortBy(-_._2).map(Recap.Perf.apply)
    )

  private def runGameScan(userId: UserId): Fu[GameScan] =
    val query =
      Query.createdBetween(dateStart.some, dateEnd.some) ++
        Query.user(userId) ++
        Query.finished ++
        Query.turnsGt(2) ++
        Query.notFromPosition
    gameRepo
      .sortedCursor(query, Query.sortChronological)
      .documentSource()
      .runFold(GameScan())(_.addGame(userId)(_))
      .monSuccess(lila.mon.recap.games)

  private case class GameScan(
      nbs: NbWin = NbWin(),
      nbRed: Int = 0,
      nbMoves: Int = 0,
      secondsPlaying: Int = 0,
      firstRedMoves: Map[String, Int] = Map.empty,
      sources: Map[Source, Int] = Map.empty,
      opponents: Map[UserId, Int] = Map.empty,
      perfs: Map[String, Int] = Map.empty
  ):
    def addKingdoms(user: UserId, game: lila.threeKingdoms.KingdomGame): GameScan =
      val player = game.playerOf(user).get
      val elapsed =
        math.max(0L, game.clock.config.initialSeconds * 1000L - game.clock.remaining(player.ordinal)) / 1000
      val source = game.source match
        case "pool" => Source.Pool
        case "computer" => Source.Ai
        case "tournament" => Source.Arena
        case _ => Source.Friend
      copy(
        nbs = NbWin(nbs.total + 1, nbs.win + (if game.position.placement(player).contains(1d) then 1 else 0)),
        nbMoves = nbMoves + game.events.count(e =>
          e.actor == player && lila.threeKingdoms.Move.parse(e.action).nonEmpty
        ),
        secondsPlaying = secondsPlaying + elapsed.toInt,
        sources = sources.updatedWith(source)(n => Some(n.getOrElse(0) + 1)),
        opponents = game.userIds
          .filterNot(_ == user)
          .foldLeft(opponents)((all, id) => all.updatedWith(id)(n => Some(n.getOrElse(0) + 1))),
        perfs = perfs.updatedWith("threeKingdoms")(n => Some(n.getOrElse(0) + 1))
      )

    def addGame(userId: UserId)(g: Game): GameScan =
      g.player(userId)
        .fold(this): player =>
          val opponent = g.opponent(player).userId
          val winner = g.winnerUserId
          val durationSeconds = g.hasClock.so(g.durationSeconds) | 30 // ?? :shrug:
          copy(
            nbs = NbWin(
              total = nbs.total + 1,
              win = nbs.win + winner.exists(_.is(userId)).so(1)
            ),
            nbRed = nbRed + player.color.fold(1, 0),
            nbMoves = nbMoves + g.playerMoves(player.color),
            secondsPlaying = secondsPlaying + durationSeconds,
            firstRedMoves = player.color
              .fold(true, false)
              .so(g.xiangqi.wxf.headOption)
              .fold(firstRedMoves): move =>
                firstRedMoves.updatedWith(move)(_.fold(1)(_ + 1).some),
            sources = g.source.fold(sources): source =>
              sources.updatedWith(source)(_.fold(1)(_ + 1).some),
            opponents = opponent.fold(opponents): op =>
              opponents.updatedWith(op)(_.fold(1)(_ + 1).some),
            perfs = perfs.updatedWith(g.perfKey.value): pk =>
              some(pk.orZero + 1)
          )
