package lila.tv

import chess.{ ByColor, Color, Rated, Status }
import lila.core.game.{ Player, Source }
import lila.core.id.GamePlayerId
import lila.core.rank.RankTrackId
import lila.xiangqi.Xiangqi

class TvTest extends munit.FunSuite:
  test("every native variant has an isolated channel for human and computer games"):
    val variants = lila.xiangqi.GameVariant.values.toList
    val channels = Tv.Channel.list.filter(_.variant.isDefined)
    assertEquals(channels.flatMap(_.variant), variants)
    for variant <- variants.filter(_.playerCount == 2); ai <- List(false, true); bot <- List(false, true) do
      val position = variant.initialGame(None, variant.defaultRuleset).toOption.get
      val candidate = Tv.Candidate(game(ai = ai).copy(xiangqi = position), bot)
      assertEquals(channels.filter(_.filter(candidate)).flatMap(_.variant), List(variant))
      assertEquals(Tv.Channel.byKey(variant.key).variant, Some(variant))
    assertEquals(Tv.Channel.byKey("threeKingdoms").variant, Some(lila.xiangqi.GameVariant.ThreeKingdoms))

  test("variant channels exclude abandoned and correspondence games"):
    val channel = Tv.Channel.Xiangqi
    assert(!channel.filter(Tv.Candidate(game().copy(movedAt = nowInstant.minusSeconds(190)), false)))
    assert(!channel.filter(Tv.Candidate(game().copy(status = Status.Aborted), false)))
    assert(!channel.filter(Tv.Candidate(game().copy(daysPerTurn = Some(scalalib.model.Days(1))), false)))

  private def game(id: String = "tvgame01", ai: Boolean = false): Game =
    lila.core.game
      .newGame(
        xiangqi = Xiangqi.Game.initial,
        players = ByColor(
          Player(GamePlayerId("red1"), Color.White, None),
          Player(GamePlayerId("blk1"), Color.Black, Option.when(ai)(1))
        ),
        rated = Rated.No,
        source = if ai then Source.Ai else Source.Lobby,
        pgnImport = None
      )
      .start
      .sloppy
      .copy(id = GameId(id))

  test("Computer includes active untimed AI games but not human or abandoned games"):
    def eligible(g: Game) = Tv.Channel.Computer.filter(Tv.Candidate(g, false))
    assert(eligible(game(ai = true)))
    assert(!eligible(game()))
    assert(!eligible(game(ai = true).copy(movedAt = nowInstant.minusSeconds(130))))
    assert(!eligible(game(ai = true).copy(status = Status.Created)))
    assert(!eligible(game(ai = true).copy(status = Status.Aborted)))
    assert(eligible(game(ai = true).copy(status = Status.Mate)))
    assert(!eligible(game(ai = true).copy(status = Status.Mate, movedAt = nowInstant.minusSeconds(10))))

  test("ranked and bot channels respect native Xiangqi and account type"):
    val ranked = game().copy(
      rated = Rated.Yes,
      rankTrack = Some(RankTrackId.xiangqi),
      clock = Some(lila.core.game.RankedGame.xiangqiClock.toClock)
    )
    assert(Tv.Channel.Best.filter(Tv.Candidate(ranked, false)))
    assert(!Tv.Channel.Best.filter(Tv.Candidate(ranked, true)))
    assert(Tv.Channel.Bot.filter(Tv.Candidate(ranked, true)))
    assert(!Tv.Channel.Bot.filter(Tv.Candidate(ranked, false)))
    val jieqi = ranked.copy(xiangqi = lila.xiangqi.Jieqi.initial().toOption.get)
    assert(!Tv.Channel.Bot.filter(Tv.Candidate(jieqi, true)))
    assert(!Tv.Channel.Best.filter(Tv.Candidate(jieqi, false)))

  test("history retains eight distinct previous broadcasts and excludes the current game"):
    val ids = (1 to 12).toList.map(n => GameId(f"game$n%04d"))
    val history = ids.foldLeft(List.empty[GameId])((h, id) => TvHistory.prepend(id, h))
    assertEquals(history, ids.reverse.take(9))
    assertEquals(TvHistory.prepend(ids.last, history), history)
    val revisited = TvHistory.prepend(history(3), history)
    assertEquals(revisited.head, history(3))
    assertEquals(revisited.distinct, revisited)
    assertEquals(revisited.size, 9)

  test("selection preserves a live broadcast until a substantially stronger game appears"):
    val current = game()
    val other = game("tvgame02")
    def choose(score: Int) = ChannelSelection.choose(
      List(current, other),
      Some(current.id),
      Some(other.id),
      g => if g.id == current.id then 100 else score
    )
    assertEquals(choose(110), None)
    assertEquals(choose(118).map(_.id), Some(other.id))

  test("rematches cannot bypass eligibility and a stale current game cannot block replacements"):
    val current = game()
    val other = game("tvgame02")
    assertEquals(
      ChannelSelection.choose(List(other), Some(current.id), Some(GameId("excluded")), _ => 100),
      Some(other)
    )
    assertEquals(ChannelSelection.choose(Nil, Some(current.id), Some(other.id), _ => 100), None)
    assertEquals(
      ChannelSelection
        .choose(List(current.copy(status = Status.Mate), other), Some(current.id), Some(other.id), _ => 100),
      Some(other)
    )
