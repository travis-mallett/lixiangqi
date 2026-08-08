package lila.game

import chess.variant.Variant
import chess.{ Centis, Clock, Color, Ply, Speed, Status }
import scalalib.model.Days

import lila.core.game.{ ClockHistory, Game, Player, Pov, Source }
import lila.game.Blurs.addAtMoveIndex
import lila.rating.PerfType

object GameExt:

  def computeMoveTimes(g: Game, color: Color): Option[List[Centis]] = {
    for
      clk <- g.clock
      inc = clk.incrementOf(color)
      history <- g.clockHistory
      clocks = history(color)
    yield Centis(0) :: {
      val pairs = clocks.iterator.zip(clocks.iterator.drop(1))

      // We need to determine if this color's last clock had inc applied.
      // if finished and history.size == playedTurns then game was ended
      // by a players move, such as with mate or autodraw. In this case,
      // the last move of the game, and the only one without inc, is the
      // last entry of the clock history for !turnColor.
      //
      // On the other hand, if history.size is more than playedTurns,
      // then the game ended during a players turn by async event, and
      // the last recorded time is in the history for turnColor.
      val clocksRecorded = history.mapReduce(_.size)(_ + _)
      val noLastInc = g.finished && (g.playedPlies >= clocksRecorded) == (color != g.turnColor)

      pairs
        .map: (first, second) =>
          {
            val d = first - second
            if pairs.hasNext || !noLastInc then d + inc else d
          }.nonNeg
        .toList
    }
  }.orElse(g.binaryMoveTimes.map: binary =>
    // TODO: make movetime.read return List after writes are disabled.
    val base = BinaryFormat.moveTime.read(binary, g.playedPlies)
    val mts = if color == g.startColor then base else base.drop(1)
    everyOther(mts.toList))

  def analysable(g: Game) =
    g.replayable && g.playedPlies > 4 &&
      Game.analysableVariants(g.variant)

  extension (clockHistory: ClockHistory)

    def recordNewClock(color: Color, clock: Clock) =
      clockHistory.update(color, _ :+ clock.remainingTime(color))

    def resetClockHistory(color: Color) = clockHistory.update(color, _ => Vector.empty)

  extension (g: Game)

    def playerIdPov(playerId: GamePlayerId): Option[Pov] = g.playerById(playerId).map(p => Pov(g, p.color))

    def withClock(c: Clock) = Progress(g, g.copy(clock = Some(c)))

    def startClock: Option[Progress] =
      g.clock
        .filter(c => !c.isRunning || g.moveTimePaused)
        .map: c =>
          Progress(g, g.start.copy(clock = Some(c.start), moveTimePaused = false))

    def playerHasOfferedDrawRecently(color: Color) =
      g.drawOffers.lastBy(color).exists(_ >= g.ply - 20)

    def playerCanOfferDraw(color: Color) =
      g.started && g.playable &&
        g.ply >= 2 &&
        !g.player(color).isOfferingDraw &&
        !g.opponent(color).isAi &&
        !g.playerHasOfferedDrawRecently(color) &&
        !g.swissPreventsDraw &&
        !g.rulePreventsDraw

    def goBerserk(color: Color): Option[Progress] =
      g.clock
        .ifTrue(g.berserkable && !g.player(color).berserk)
        .map: c =>
          val newClock = c.goBerserk(color)
          Progress(
            g,
            g.copy(
              clock = Some(newClock),
              loadClockHistory = _ =>
                g.clockHistory.map: history =>
                  if history(color).isEmpty then history
                  else history.resetClockHistory(color).recordNewClock(color, newClock)
            ).updatePlayer(color, _.copy(berserk = true))
          ) ++
            List(
              Event.ClockInc(color, -c.config.berserkPenalty, newClock),
              Event.Clock(newClock, g.moveTimeRemaining), // BC
              Event.Berserk(color)
            )

    def setBlindfold(color: Color, blindfold: Boolean): Progress =
      Progress(g, g.updatePlayer(color, _.copy(blindfold = blindfold)), Nil)

    def moveTimes: Option[Vector[Centis]] = for
      a <- GameExt.computeMoveTimes(g, g.startColor)
      b <- GameExt.computeMoveTimes(g, !g.startColor)
    yield lila.core.game.interleave(a, b)

    // apply a move
    def applyMove(
        game: lila.xiangqi.Xiangqi.Game,
        move: lila.xiangqi.Xiangqi.MoveResult,
        clock: Option[Clock],
        blur: Boolean = false
    ): Progress =

      def copyPlayer(player: Player) =
        if blur && g.turnColor == player.color then
          player.copy(blurs = player.blurs.addAtMoveIndex(g.playerMoves(player.color)))
        else player

      // This must be computed eagerly
      // because it depends on the current time
      val newClockHistory = for
        clk <- g.clock
        ch <- g.clockHistory
      yield ch.recordNewClock(g.turnColor, clk)

      val updated = g.copy(
        players = game.state.gameResult.winner.fold(g.players.map(copyPlayer)): side =>
          val winner = if side == lila.xiangqi.Xiangqi.Side.Red then Color.White else Color.Black
          g.players.map(copyPlayer).update(winner, _.copy(isWinner = true.some))
        ,
        xiangqi = game,
        clock = clock,
        binaryMoveTimes = (!g.sourceIs(_.Import) && g.clock.isEmpty).option {
          BinaryFormat.moveTime.write {
            g.binaryMoveTimes.so { t =>
              BinaryFormat.moveTime.read(t, g.playedPlies)
            } :+ Centis.ofLong(nowCentis - g.movedAt.toCentis).nonNeg
          }
        },
        loadClockHistory = _ => newClockHistory,
        status =
          if !game.state.ended then g.status
          else if game.state.gameResult.winner.isDefined then Status.Mate
          else Status.Draw,
        movedAt = nowInstant
      )

      val state = Event.State(
        turns = Ply(game.state.ply),
        status = (g.status != updated.status).option(updated.status),
        winner = game.state.gameResult.winner.map:
          case lila.xiangqi.Xiangqi.Side.Red => Color.White
          case lila.xiangqi.Xiangqi.Side.Black => Color.Black
        ,
        whiteOffersDraw = g.whitePlayer.isOfferingDraw,
        blackOffersDraw = g.blackPlayer.isOfferingDraw
      )

      val clockEvent = Event
        .Clock(updated)
        .orElse:
          updated.playableCorrespondenceClock.map(Event.CorrespondenceClock.apply)

      val events = Event.Move(move, state, clockEvent) :: Nil

      Progress(g, updated, events)
    end applyMove

    def finish(status: Status, winner: Option[Color]): Game =
      g.copy(
        status = status,
        players = winner.fold(g.players): c =>
          g.players.update(c, _.copy(isWinner = true.some)),
        clock = g.clock.map(_.stop),
        loadClockHistory = clk =>
          g.clockHistory.map: history =>
            // If not already finished, we're ending due to an event
            // in the middle of a turn, such as resignation or draw
            // acceptance. In these cases, record a final clock time
            // for the active color. This ensures the end time in
            // clockHistory always matches the final clock time on
            // the board.
            if !g.finished then history.recordNewClock(g.turnColor, clk)
            else history
      )

    def abandoned = (g.status <= Status.Started) && (g.movedAt.isBefore(Game.abandonedDate))

    def playerBlurPercent(color: Color): Int =
      if g.playedPlies > 5
      then (g.player(color).blurs.nb * 100) / g.playerMoves(color)
      else 0

    def drawReason =
      if g.position.insufficientMaterial then DrawReason.InsufficientMaterial.some
      else if g.drawOffers.normalizedPlies.exists(g.ply <= _) then DrawReason.MutualAgreement.some
      else None

    def perfType: PerfType = PerfType(g.perfKey)

    def timeForFirstMove: Centis =
      Centis.ofSeconds:
        import chess.Speed.*
        if g.isTournament then
          g.speed match
            case UltraBullet => 11
            case Bullet => 16
            case Blitz => 21
            case Rapid => 25
            case _ => 30
        else
          g.speed match
            case UltraBullet => 15
            case Bullet => 20
            case Blitz => 25
            case Rapid => 30
            case _ => 35

    def expirable =
      !g.bothPlayersHaveMoved &&
        g.source.exists(Source.expirable.contains) &&
        g.playable &&
        g.nonAi &&
        g.clock.exists(!_.isRunning)

    def hasFirstMoveDeadline = g.expirable

  end extension

  private def everyOther[A](l: List[A]): List[A] =
    l match
      case a :: _ :: tail => a :: everyOther(tail)
      case _ => l

end GameExt

object Game:

  val syntheticId = GameId("synthetic")

  val maxPlies = Ply(600) // unlimited would be a DoS target
  val xiangqiSchemaVersion = 1

  val analysableVariants: Set[Variant] = Set(chess.variant.Standard, chess.variant.FromPosition)

  val unanalysableVariants: Set[Variant] = Variant.list.all.toSet -- analysableVariants

  val abandonedDays = Days(21)
  def abandonedDate = nowInstant.minusDays(abandonedDays.value)

  def isBoardCompatible(game: Game): Boolean =
    game.clockConfig.forall: c =>
      lila.core.game.isBoardCompatible(c) || {
        (game.hasAi || game.sourceIs(_.Friend) || game.sourceIs(_.Api)) &&
        chess.Speed(c) >= Speed.Blitz
      }

  // if source is Arena, we will also need to check if the arena accepts bots!
  def isBotCompatible(game: Game): Option[Boolean] =
    if !game.clockConfig.forall(lila.core.game.isBotCompatible) then false.some
    else if game.hasAi || game.sourceIs(_.Friend) || game.sourceIs(_.Api) then true.some
    else if game.sourceIs(_.Arena) then none
    else false.some

  def mightBeBoardOrBotCompatible(game: Game) = isBoardCompatible(game) || isBotCompatible(game).|(true)

  object BSONFields:
    export lila.core.game.BSONFields.*
    val xiangqiVersion = "xv"
    val xiangqi = "xg"
    val whitePlayer = "p0"
    val blackPlayer = "p1"
    val playerIds = "is"
    val status = "s"
    val startedAtTurn = "st"
    val clock = "c"
    val moveTimeLimit = "ml"
    val moveTimePaused = "mp"
    val daysPerTurn = "cd"
    val moveTimes = "mt"
    val whiteClockHistory = "cw"
    val blackClockHistory = "cb"
    val rated = "ra"
    val variant = "v"
    val bookmarks = "bm"
    val source = "so"
    val tournamentId = "tid"
    val swissId = "iid"
    val simulId = "sid"
    val tvAt = "tv"
    val winnerColor = "w"
    val initialFen = "if"
    val checkAt = "ck"
    val drawOffers = "do"
    val rules = "rules"
    val abortedBy = "ab"

enum DrawReason:
  case MutualAgreement, InsufficientMaterial
