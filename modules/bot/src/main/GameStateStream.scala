package lila.bot

import org.apache.pekko.actor.*
import org.apache.pekko.stream.scaladsl.*
import play.api.libs.json.*
import scalalib.ThreadLocalRandom
import scalalib.net.UserAgent

import lila.chat.{ Chat, UserLine }
import lila.common.Bus
import lila.common.actorBus.*
import lila.core.game.{ AbortedBy, FinishGame, WithInitialFen }
import lila.core.round.{ Tell, RoundBus }
import lila.core.user.KidMode
import lila.game.actorApi.{
  BoardDrawOffer,
  BoardGone,
  BoardTakeback,
  BoardTakebackOffer,
  BoardMoretime,
  BoardBerserk,
  MoveGameEvent
}
import lila.bot.OnlineApiUsers.*

final class GameStateStream(
    onlineApiUsers: OnlineApiUsers,
    jsonView: BotJsonView
)(using system: ActorSystem)(using Executor):

  import GameStateStream.*

  private val blueprint =
    Source.queue[Option[JsObject]](32, org.apache.pekko.stream.OverflowStrategy.dropHead)

  def apply(init: WithInitialFen, as: Color)(using
      ua: UserAgent,
      me: Me
  ): Source[Option[JsObject], ?] =
    open(init, as, User(me.value.id.some, me.isBot, me.kid), _ => fuccess(Json.obj()))

  def mobile(init: WithInitialFen, as: Color, me: Option[Me], extra: Game => Fu[JsObject])(using
      UserAgent
  ): Source[Option[JsObject], ?] =
    open(init, as, User(me.map(_.value.id), false, me.fold(KidMode.Yes)(_.kid)), extra)

  private def open(
      init: WithInitialFen,
      as: Color,
      user: User,
      extra: Game => Fu[JsObject]
  )(using ua: UserAgent): Source[Option[JsObject], ?] =

    // terminate previous one if any
    Bus.publishDyn(PoisonPill, uniqChan(init.game.pov(as)))

    blueprint.mapMaterializedValue: queue =>
      val actor = system.actorOf(
        Props(mkActor(init, as, user, extra, queue)),
        name = s"GameStateStream:${init.game.id}:${ThreadLocalRandom.nextString(8)}"
      )
      queue
        .watchCompletion()
        .addEffectAnyway:
          actor ! PoisonPill

  private def uniqChan(pov: Pov)(using ua: UserAgent) =
    s"gameStreamFor:${pov.fullId}:$ua"

  private def mkActor(
      init: WithInitialFen,
      as: Color,
      user: User,
      extra: Game => Fu[JsObject],
      queue: SourceQueueWithComplete[Option[JsObject]]
  )(using UserAgent): Actor = new:

    import init.game.id

    var gameOver = false
    private var stateQueue: Funit = funit

    private val classifiers = List(
      MoveGameEvent.makeChan(id),
      BoardDrawOffer.makeChan(id),
      BoardTakeback.makeChan(id),
      BoardTakebackOffer.makeChan(id),
      BoardMoretime.makeChan(id),
      BoardBerserk.makeChan(id),
      BoardGone.makeChan(id),
      uniqChan(init.game.pov(as))
    ) :::
      user.kid.no.option(Chat.chanOf(id.into(ChatId))).toList :::
      user.isBot.option(Chat.chanOf(ChatId(s"$id/w"))).toList

    override def preStart(): Unit =
      super.preStart()
      Bus.subscribeActorRef[lila.core.game.FinishGame](self)
      Bus.subscribeActorRef[lila.core.game.AbortedBy](self)
      Bus.subscribeActorRefDyn(self, classifiers)
      stateQueue = jsonView
        .gameFull(init, Some(as))
        .zip(extra(init.game))
        .map { (json, additions) =>
          // prepend the full game JSON at the start of the stream
          queue.offer(
            (json ++ Json.obj(
              "playerColor" -> (if as.white then "red" else "black"),
              "state" -> (json.value("state").as[JsObject] ++ additions)
            )).some
          )
          // close stream if game is over
          if init.game.finishedOrAborted then onGameOver(none)
          else self ! SetOnline
        }
        .recover:
          case _ => self ! PoisonPill
      lila.mon.bot.gameStream("start").increment()
      Bus.pub(Tell(init.game.id, RoundBus.BotConnected(as, v = true)))

    override def postStop(): Unit =
      super.postStop()
      classifiers.foreach(Bus.unsubscribeActorRefDyn(self, _))
      Bus.unsubscribeActorRef[lila.core.game.FinishGame](self)
      Bus.unsubscribeActorRef[lila.core.game.AbortedBy](self)
      // hang around if game is over
      // so the opponent has a chance to rematch
      context.system.scheduler.scheduleOnce(if gameOver then 10.second else 1.second):
        Bus.pub(Tell(init.game.id, RoundBus.BotConnected(as, v = false)))
      queue.complete()
      lila.mon.bot.gameStream("stop").increment()

    def receive =
      case MoveGameEvent(g, _, _) if g.id == id && !g.finished => pushState(g)
      case lila.chat.ChatLine(chatId, UserLine(username, text, false, false), _) =>
        pushChatLine(username, text, chatId.value.lengthIs == GameId.size)
      case FinishGame(g, _) if g.id == id => onGameOver(g.some)
      case AbortedBy(pov) if pov.gameId == id => onGameOver(pov.game.some)
      case BoardDrawOffer(g) if g.id == id => pushState(g)
      case BoardTakebackOffer(g) if g.id == id => pushState(g)
      case BoardTakeback(g) if g.id == id => pushState(g)
      case BoardMoretime(g) if g.id == id => pushState(g)
      case BoardBerserk(g) if g.id == id => pushState(g)
      case BoardGone(pov, seconds) if pov.gameId == id && pov.color != as => opponentGone(seconds)
      case SetOnline =>
        user.id.foreach(onlineApiUsers.setOnline)
        context.system.scheduler.scheduleOnce(7.second, self, CheckOnline)
      case CheckOnline =>
        queue.offer(None) // prevents the client and intermediate proxies from closing the idle stream
        Bus.pub(Tell(id, RoundBus.QuietFlagCheck))
        self ! SetOnline

    def pushState(g: Game): Funit =
      stateQueue = stateQueue.flatMap: _ =>
        jsonView
          .gameState(WithInitialFen(g, init.fen), Some(as))
          .zip(extra(g))
          .map((state, additions) => (state ++ additions).some)
          .flatMap(queue.offer)
          .void
          .recover:
            case _ => self ! PoisonPill
      stateQueue

    def pushChatLine(username: UserName, text: String, player: Boolean) =
      queue.offer(jsonView.chatLine(username, text, player).some)

    def opponentGone(claimInSeconds: Option[Int]) = queue.offer:
      claimInSeconds.fold(jsonView.opponentGoneIsBack)(jsonView.opponentGoneClaimIn).some

    def onGameOver(g: Option[Game]) =
      for _ <- g.so(pushState)
      do
        gameOver = true
        self ! PoisonPill

private object GameStateStream:

  private case class User(id: Option[UserId], isBot: Boolean, kid: KidMode)
