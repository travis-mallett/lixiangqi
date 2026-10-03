package lila.study

import chess.format.Fen
import chess.format.pgn.{ PgnStr, Tags }
import lila.xiangqi.Xiangqi.Side

import lila.core.game.Namer
import lila.core.id.GameFullId
import lila.tree.{ Branches, Root }
import lila.xiangqi.{ Xiangqi, XiangqiRules }

final private class ChapterMaker(
    net: lila.core.config.NetConfig,
    lightUser: lila.core.user.LightUserApi,
    chatApi: lila.core.chat.ChatApi,
    gameRepo: lila.core.game.GameRepo,
    pgnDump: lila.core.game.PgnDump,
    namer: lila.core.game.Namer
)(using Executor):

  import ChapterMaker.*

  def apply(
      study: Study,
      data: Data,
      order: Int,
      userId: UserId,
      withRatings: Boolean,
      nameOrder: Option[Int] = None
  ): Fu[Chapter] =
    data.game
      .so(parseGame)
      .flatMap:
        case None if data.game.isDefined => fufail(StudyValidationException("Game could not be found"))
        case None => fromFenOrPgnOrBlank(study, data, order, userId)
        case Some(game) => fromGame(study, game, data, order, userId, withRatings)
      .map: c =>
        if c.name.value.isEmpty then c.copy(name = Chapter.defaultName(nameOrder | order)) else c

  def fromFenOrPgnOrBlank(study: Study, data: Data, order: Int, userId: UserId): Fu[Chapter] =
    data.pgn.filter(_.value.trim.nonEmpty) match
      case Some(pgn) => fromPgn(study, pgn, data, order, userId)
      case None => fuccess(fromFenOrBlank(study, data, order, userId))

  def toStudyPgn(study: Study, pgn: PgnStr): Fu[StudyPgnImport.Result] = for
    contributors <- lightUser.asyncMany(study.members.contributorIds.toList)
    parsed <- StudyPgnImport.result(pgn, contributors.flatten).toFuture.recoverWith { case e: Exception =>
      fufail(StudyValidationException(e.getMessage))
    }
  yield parsed

  private def fromPgn(study: Study, pgn: PgnStr, data: Data, order: Int, userId: UserId): Fu[Chapter] =
    for
      parsed <- toStudyPgn(study, pgn)
      settings = data.copy(
        mode = if data.mode == Mode.Normal then parsed.metadata.mode.getOrElse(data.mode) else data.mode,
        orientation = if data.orientation == Orientation.Auto then
          parsed.metadata.orientation.fold(data.orientation)(Orientation.Fixed.apply)
        else data.orientation
      )
    yield Chapter
      .make(
        studyId = study.id,
        name = getChapterNameFromPgn(data, parsed),
        setup = Chapter.Setup(
          none,
          resolveOrientation(settings, parsed.root, userId, parsed.tags)
        ),
        root = parsed.root,
        tags = parsed.tags,
        order = order,
        ownerId = userId,
        practice = settings.isPractice,
        gamebook = settings.isGamebook,
        conceal = settings.isConceal.option(parsed.metadata.conceal.getOrElse(parsed.root.ply))
      )
      .copy(description = parsed.metadata.description)

  private def getChapterNameFromPgn(data: Data, parsed: StudyPgnImport.Result): StudyChapterName =
    def fromPgnTags =
      (parsed.tags("Red"), parsed.tags(_.Black)) match
        case (Some(red), Some(black)) => Some(s"$red - $black")
        case (Some(red), None) => Some(red)
        case (None, Some(black)) => Some(black)
        case (None, None) => parsed.tags("Event")
    data.name.some
      .ifFalse(data.isDefaultName)
      .orElse(parsed.chapterNameHint)
      .orElse:
        StudyChapterName.from:
          fromPgnTags.map(_.trim).filter(_.nonEmpty)
      .getOrElse(data.name)

  private def resolveOrientation(data: Data, root: Root, userId: UserId, tags: Tags = Tags.empty): Side =
    def isMe(name: Option[chess.PlayerName]) = name.flatMap(n => UserStr.read(n.value)).exists(_.is(userId))
    data.orientation match
      case Orientation.Fixed(color) => color
      case _ if isMe(StudyPgnTags.names(tags).red) => Side.Red
      case _ if isMe(StudyPgnTags.names(tags).black) => Side.Black
      // If it is a concealed chapter (puzzles from a coach/book/course), start from side which moves first
      case _ if data.isConceal => root.color
      // if an outcome is known, then it's a finished game, which we show from red perspective by convention
      case _ if StudyPgnTags.points(tags).isDefined => Side.Red
      // in gamebooks (interactive chapter), we guess the orientation based on the last node
      case _ if data.isGamebook => !root.lastMainlineNode.color
      // else we show from the perspective of whoever turn it is to move
      case _ => root.lastMainlineNode.color

  def fromFenOrBlank(study: Study, data: Data, order: Int, userId: UserId): Chapter =
    val fen = data.fen.fold(Xiangqi.startFen)(_.value)
    val root = Root
      .fromPosition(Xiangqi.Position(initialFen = fen))
      .fold(error => throw StudyValidationException(error), identity)
    val isFromFen = data.fen.isDefined
    Chapter.make(
      studyId = study.id,
      name = data.name,
      setup = Chapter.Setup(
        none,
        resolveOrientation(data, root, userId),
        fromFen = isFromFen.option(true)
      ),
      root = root,
      tags = Tags.empty,
      order = order,
      ownerId = userId,
      practice = data.isPractice,
      gamebook = data.isGamebook,
      conceal = data.isConceal.option(root.ply),
      relay = none
    )

  private def fromGame(
      study: Study,
      game: Game,
      data: Data,
      order: Int,
      userId: UserId,
      withRatings: Boolean,
      initialFen: Option[Fen.Full] = None
  ): Fu[Chapter] =
    for
      root <- makeRoot(game, data.pgn, initialFen)
      tags <- pgnDump.tags(game, initialFen, none, withOpening = true.some, withRatings)
      name <-
        if data.isDefaultName then
          StudyChapterName.from(namer.gameVsText(game, withRatings)(using lightUser.async))
        else fuccess(data.name)
      _ = notifyChat(study, game, userId)
    yield Chapter.make(
      studyId = study.id,
      name = name,
      setup = Chapter.Setup(
        (!game.synthetic).option(game.id),
        data.orientation match
          case Orientation.Auto => Side.Red
          case Orientation.Fixed(color) => color
      ),
      root = root,
      tags = StudyPgnTags(tags),
      order = order,
      ownerId = userId,
      practice = data.isPractice,
      gamebook = data.isGamebook,
      conceal = data.isConceal.option(root.ply)
    )

  def notifyChat(study: Study, game: Game, userId: UserId) =
    if study.isPublic then
      List(game.hasUserId(userId).option(game.id.value), s"${game.id}/w".some).flatten.foreach { chatId =>
        chatApi.write(
          chatId = ChatId(chatId),
          userId = userId,
          text = s"I'm studying this game on ${net.domain}/study/${study.id}",
          publicSource = none,
          _.round,
          persist = false
        )
      }

  def makeRoot(
      game: Game,
      pgnOpt: Option[PgnStr],
      initialFen: Option[Fen.Full]
  ): Fu[Root] =
    initialFen
      .fold(gameRepo.initialFen(game)): fen =>
        fuccess(fen.some)
      .map: goodFen =>
        val fromGame = GameToRoot(game, goodFen, withClocks = true)
        pgnOpt match
          case Some(pgn) =>
            val imported = StudyPgnImport
              .result(pgn, Nil)
              .fold(error => throw StudyValidationException(error.value), _.root)
            require(
              imported.fen == fromGame.fen && imported.ruleset == fromGame.ruleset,
              "Imported game history/ruleset mismatch"
            )
            fromGame.merge(imported)
          case None => fromGame

  private val UrlRegex = {
    val escapedDomain = net.domain.value.replace(".", "\\.")
    s"""$escapedDomain/(\\w{8,12})"""
  }.r.unanchored

  @scala.annotation.tailrec
  private def parseGame(str: String): Fu[Option[Game]] =
    str match
      case s if s.lengthIs == GameId.size => gameRepo.game(GameId(s))
      case s if s.lengthIs == GameFullId.size => gameRepo.game(GameId.take(s))
      case UrlRegex(id) => parseGame(id)
      case _ => fuccess(none)

private object ChapterMaker:

  enum Mode:
    def key = toString.toLowerCase
    case Normal, Practice, Gamebook, Conceal
  object Mode:
    def apply(key: String) = values.find(_.key == key)

  trait ChapterData:
    def orientation: Orientation
    def mode: ChapterMaker.Mode
    def isPractice = mode == Mode.Practice
    def isGamebook = mode == Mode.Gamebook
    def isConceal = mode == Mode.Conceal

  enum Orientation(val key: String, val resolve: Option[Side]):
    case Fixed(color: Side) extends Orientation(color.key, color.some)
    case Auto extends Orientation("automatic", none)
  object Orientation:
    def apply(str: String): Option[Orientation] =
      if str == Auto.key then Some(Auto) else Side.fromKey(str).toOption.map(Fixed.apply)

  case class Data(
      name: StudyChapterName,
      game: Option[String] = None,
      fen: Option[Fen.Full] = None,
      pgn: Option[PgnStr] = None,
      orientation: Orientation = Orientation.Auto,
      mode: ChapterMaker.Mode = ChapterMaker.Mode.Normal,
      initial: Boolean = false,
      isDefaultName: Boolean = true
  ) extends ChapterData:

    def manyGames: Option[List[Data]] =
      game
        .so(_.linesIterator.toList)
        .map(_.trim)
        .filter(_.nonEmpty)
        .map { g => copy(game = g.some) }
        .some
        .filter(_.sizeIs > 1)

  case class EditData(
      id: StudyChapterId,
      name: StudyChapterName,
      orientation: Orientation,
      mode: ChapterMaker.Mode,
      description: String // boolean
  ) extends ChapterData:
    def hasDescription = description.nonEmpty

  case class DescData(id: StudyChapterId, desc: String):
    lazy val clean = lila.common.String.fullCleanUp(desc)
