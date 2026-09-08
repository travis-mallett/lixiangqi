package lila.lobby

import chess.ByColor

import lila.core.socket.Sri
import lila.xiangqi.Xiangqi

final private class Biter(
    userApi: lila.core.user.UserApi,
    gameRepo: lila.core.game.GameRepo,
    newPlayer: lila.core.game.NewPlayer
)(using Executor)(using idGenerator: lila.core.game.IdGenerator):

  def apply(hook: Hook, sri: Sri, user: Option[LobbyUser]): Fu[JoinHook] =
    if canJoin(hook, user)
    then join(hook, sri, user)
    else fufail(s"$user cannot bite hook $hook")

  def apply(seek: Seek, user: LobbyUser): Fu[JoinSeek] =
    if canJoin(seek, user)
    then join(seek, user)
    else fufail(s"$user cannot join seek $seek")

  private def join(hook: Hook, sri: Sri, lobbyUserOption: Option[LobbyUser]): Fu[JoinHook] =
    for
      (joiner, owner) = lobbyUserOption -> hook.user
      ownerColor <- assignCreatorColor(owner, joiner, hook.color)
      game <- idGenerator.withUniqueId:
        makeGame(
          hook,
          ownerColor.fold(ByColor(owner, joiner), ByColor(joiner, owner))
        )
      _ <- gameRepo.insertDenormalized(game)
    yield
      lila.mon.lobby.hook.join.increment()
      JoinHook(sri, hook, game, ownerColor)

  private def join(seek: Seek, lobbyUser: LobbyUser): Fu[JoinSeek] =
    for
      (joiner, owner) = lobbyUser -> seek.user
      ownerColor <- assignCreatorColor(owner.some, joiner.some, TriColor.Random)
      game <- idGenerator.withUniqueId:
        makeGame(
          seek,
          ownerColor.fold(ByColor(owner, joiner), ByColor(joiner, owner)).map(some)
        )
      _ <- gameRepo.insertDenormalized(game)
    yield JoinSeek(joiner.id, seek, game, ownerColor)

  private def assignCreatorColor(
      creator: Option[LobbyUser],
      joiner: Option[LobbyUser],
      color: TriColor
  ): Fu[Color] =
    color match
      case TriColor.Random => userApi.firstGetsWhite(creator.map(_.id), joiner.map(_.id)).map(Color.fromWhite)
      case fixed =>
        creator.map(_.id).foreach(userApi.incColor(_, fixed.resolve()))
        fuccess(fixed.resolve())

  private def makeGame(hook: Hook, users: ByColor[Option[LobbyUser]]) = lila.core.game
    .newGame(
      xiangqi = Xiangqi.Game.initial,
      players = users.mapWithColor: (color, user) =>
        user.fold(newPlayer.anon(color))(u => newPlayer(color, u.id, u.rank)),
      rated = chess.Rated.No,
      source = lila.core.game.Source.Lobby,
      pgnImport = None,
      clock = hook.clock.toClock.some,
      moveTimeLimit = hook.moveTimeLimit,
      variant = hook.realVariant
    )
    .start

  private def makeGame(seek: Seek, users: ByColor[Option[LobbyUser]]) = lila.core.game
    .newGame(
      xiangqi = Xiangqi.Game.initial,
      players = users.mapWithColor: (color, user) =>
        user.fold(newPlayer.anon(color))(u => newPlayer(color, u.id, u.rank)),
      rated = chess.Rated.No,
      source = lila.core.game.Source.Lobby,
      daysPerTurn = seek.daysPerTurn,
      pgnImport = None,
      variant = seek.realVariant
    )
    .start

  def canJoin(hook: Hook, user: Option[LobbyUser]): Boolean =
    hook.isAuth == user.isDefined && user.forall: u =>
      u.lame == hook.lame &&
        !hook.userId.contains(u.id) &&
        !hook.userId.so(u.blocking.value.contains) &&
        !hook.user.so(_.blocking).value.contains(u.id)

  def canJoin(seek: Seek, user: LobbyUser): Boolean =
    seek.user.id != user.id &&
      (user.lame == seek.user.lame) &&
      !(user.blocking.value contains seek.user.id) &&
      !(seek.user.blocking.value contains user.id)

  def showHookTo(hook: Hook, member: LobbySocket.Member): Boolean =
    hook.sri == member.sri || canJoin(hook, member.user)
