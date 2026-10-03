package lila.relay

import lila.xiangqi.UciPath
import lila.xiangqi.Xiangqi.Side
import chess.format.pgn.{ Tag, Tags }

import lila.core.socket.Sri
import lila.study.*
import lila.tree.{ Branch, Node }
import lila.study.AddNode
import lila.common.Bus

final private class RelaySync(
    studyApi: StudyApi,
    preview: ChapterPreviewApi,
    chapterRepo: ChapterRepo,
    tourRepo: RelayTourRepo,
    groupRepo: RelayGroupRepo,
    players: RelayPlayerApi,
    teamLeaderboard: RelayTeamLeaderboard,
    notifier: RelayNotifier,
    tagManualOverride: RelayTagManualOverride
)(using Executor)(using scheduler: Scheduler):

  def updateStudyChapters(rt: RelayRound.WithTour, rawGames: RelayGames): Fu[SyncResult.Ok] = for
    study <- studyApi.byId(rt.round.studyId).orFail("Missing relay study!")
    chapters <- chapterRepo.orderedByStudyLoadingAllInMemory(study.id)
    games = rawGames.filterNot(_.isBye)
    plan = RelayUpdatePlan(chapters, games)
    _ <- plan.validate.fold(fufail, _ => funit)
    _ <-
      if chapters.size + plan.append.size > RelayFetch.maxChaptersToShow.value
      then fufail("Broadcast chapter limit exceeded; no games were imported")
      else funit
    _ <- plan.reorder.so(studyApi.sortChapters(study.id, _)(who(study.ownerId)))
    updates <- plan.update.sequentially: (chapter, game) =>
      updateChapter(rt, study, chapter, game)
    appends <- plan.append.toList.sequentially(createChapter(rt, study, _))
    groupId <- groupRepo.idByTour(rt.tour.id)
    result = SyncResult.Ok(updates ::: appends.flatten, plan)
    _ <- tourRepo.setSyncedNow(rt.tour)
    // because studies always have a chapter,
    // broadcasts without game have an empty initial chapter.
    // When a single game comes from the source, the initial chapter
    // is updated instead of created. The client might be confused.
    // So, send them all the chapter preview with `reloadChapters`
    reloadChapters = updates.exists(_.newEnd) || plan.isJustInitialChapterUpdate
    _ = if reloadChapters then
      preview.invalidate(study.id)
      studyApi.sendChapterPreviews(study)
      players.invalidate(rt.tour.id)
      teamLeaderboard.invalidate(rt.tour.id)
  yield
    Bus.publishDyn(result, SyncResult.roundBusChannel(rt.round.id))
    groupId.foreach(g => Bus.publishDyn(result, SyncResult.groupBusChannel(g)))
    result

  private def updateChapter(
      rt: RelayRound.WithTour,
      study: Study,
      chapter: Chapter,
      game: RelayGame
  ): Fu[SyncResult.ChapterResult] = for
    chapter <- updateInitialPosition(study.id, chapter, game)
    chapter <- ensureChapterRelayField(chapter, game)(using rt.tour)
    (newTags, newEnd) <- updateChapterTags(rt.tour, study, chapter, game)
    nbMoves <- updateChapterTree(study, chapter, game)(using rt.tour)
    _ = if nbMoves > 0 then notifier.onUpdate(rt, newTags.foldLeft(chapter)(_.withTags(_)))
  yield SyncResult.ChapterResult(chapter.id, newTags.isDefined, nbMoves, newEnd)

  private def createChapter(
      rt: RelayRound.WithTour,
      study: Study,
      game: RelayGame
  ): Fu[Option[SyncResult.ChapterResult]] =
    chapterRepo
      .countByStudyId(study.id)
      .flatMap: nb =>
        if nb >= RelayFetch.maxChaptersToShow.value then fufail("Broadcast chapter limit exceeded")
        else
          for
            chapter <- createChapter(study, game)(using rt.tour)
            _ <- lila.study.StudyPgnTags
              .points(chapter.tags)
              .isDefined
              .so:
                onChapterEnd(rt.tour, study, chapter)
          yield
            if chapter.root.mainline.nonEmpty then notifier.onCreate(rt, chapter)
            SyncResult.ChapterResult(chapter.id, true, chapter.root.mainline.size, false).some

  private def updateInitialPosition(studyId: StudyId, chapter: Chapter, game: RelayGame): Fu[Chapter] =
    if game.root.fen == chapter.root.fen && game.root.ruleset == chapter.root.ruleset
    then fuccess(chapter)
    else if chapter.root.children.nonEmpty then
      fufail("Broadcast initial position or ruleset changed after moves were recorded")
    else
      studyApi
        .resetRoot(studyId, chapter.id, game.root.withoutChildren)(who(chapter.ownerId))
        .dmap(_ | chapter)

  // because a study always has at least one chapter,
  // the first chapter is updated when the board data arrives, instead of created.
  // make sure it has the chapter.relay field set.
  private def ensureChapterRelayField(chapter: Chapter, game: RelayGame)(using RelayTour): Fu[Chapter] =
    val desiredRelay = makeRelayFor(game, chapter.relay.fold(game.root.mainlinePath)(_.path))
    if chapter.relay.exists(_.playerIds == desiredRelay.playerIds) then fuccess(chapter)
    else
      for _ <- chapterRepo.setRelay(chapter.id, desiredRelay)
      yield chapter.copy(relay = desiredRelay.some)

  private type NbMoves = Int

  private def forceTailMovesAsVariations(chapter: Chapter, gameMainline: UciPath)(using
      by: Who
  ): Fu[Unit] =
    // tail moves that are not in the source but are in the study chapter,
    // should become forced variations in the study chapter
    chapter.root
      .nodeAt(gameMainline)
      .map(_.children.toList.map(gameMainline + _.id))
      .foldMap(_.sequentiallyVoid: childPath =>
        studyApi.forceVariation(
          studyId = chapter.studyId,
          position = Position(chapter, childPath).ref,
          force = true
        )(by))

  private def sendLastNode(study: Study, chapter: Chapter, game: RelayGame, gameMainlinePath: UciPath)(using
      Who,
      RelayTour
  ): Funit =
    // the chapter already has all the game moves,
    // but its relayPath might be out of sync. This can happen if the broadcast
    // has contributors who use REC to record and share variations while the broadcast is ongoing.
    // If they record a variation that is then played out by the broadcast players, then there are
    // no moves to add and send to clients, but the relayPath needs to be updated,
    // both in the database, and in the clients browsers.
    // To achieve this without adding a new websocket event type, we send the last game move again,
    // which contains the relayPath.
    chapter.relay
      .exists(_.path != gameMainlinePath)
      .so:
        game.root.children
          .nodeAt(gameMainlinePath)
          .so: lastMainlineNode =>
            studyApi.addNode:
              AddNode(
                studyId = study.id,
                positionRef = Position(chapter, gameMainlinePath.parent).ref,
                node = _ => Right(lastMainlineNode),
                opts = moveOpts,
                relay = makeRelayFor(game, gameMainlinePath).some
              )

  private def addNode(study: Study, chapter: Chapter, game: RelayGame, path: UciPath, node: Branch)(using
      Who,
      RelayTour
  ): Funit =
    def insert(parent: UciPath, branch: Branch, mainline: Boolean): Funit =
      for
        _ <- studyApi.addNode(
          AddNode(
            studyId = study.id,
            positionRef = Position(chapter, parent).ref,
            node = _ => Right(branch),
            opts = moveOpts.copy(promoteToMainline = mainline && !branch.forceVariation),
            relay = makeRelayFor(game, if mainline then parent + branch.id else game.root.mainlinePath).some
          )
        )
        _ <- branch.children.toList.zipWithIndex.sequentiallyVoid: (child, index) =>
          insert(parent + branch.id, child, mainline && index == 0)
      yield ()
    insert(path, node, game.root.mainlinePath.startsWith(path + node.id))

  private def setClock(chapter: Chapter, study: Study, path: UciPath, existing: Node, current: Branch)(using
      by: Who
  ): Funit =
    current.clock
      .filter: c =>
        existing.clock.forall: prev =>
          ~c.trust && c.centis != prev.centis
      .so: c =>
        studyApi.setClock(
          studyId = study.id,
          position = Position(chapter, path).ref,
          clock = c
        )(by)

  private def updateChapterTree(study: Study, chapter: Chapter, game: RelayGame)(using
      RelayTour
  ): Fu[NbMoves] =
    given Who = who(chapter.ownerId)
    def size(branch: Branch): Int = 1 + branch.children.toList.map(size).sum
    def syncChildren(source: Node, parentPath: UciPath): Fu[Int] =
      source.children.toList
        .sequentially: incoming =>
          val path = parentPath + incoming.id
          chapter.root.nodeAt(path) match
            case None => addNode(study, chapter, game, parentPath, incoming).inject(size(incoming))
            case Some(existing) =>
              (existing.mergeAnnotations(incoming) != existing).so(
                studyApi.mergeAnnotations(study.id, Position(chapter, path).ref, incoming)(summon[Who])
              ) >>
                setClock(chapter, study, path, existing, incoming) >> syncChildren(incoming, path)
        .map(_.sum)
    for
      gameMainlinePath = game.root.mainlinePath
      _ <- (chapter.root.mergeAnnotations(game.root) != chapter.root)
        .so(studyApi.mergeAnnotations(study.id, Position(chapter, UciPath.root).ref, game.root)(summon[Who]))
      _ <- forceTailMovesAsVariations(chapter, gameMainlinePath)
      added <- syncChildren(game.root, UciPath.root)
      _ <- sendLastNode(study, chapter, game, gameMainlinePath)
    yield added

  private def updateChapterTags(
      tour: RelayTour,
      study: Study,
      chapter: Chapter,
      game: RelayGame
  ): Fu[(Option[Tags], Boolean)] = // (newTags, newEnd)
    val gameTags = game.tags.value.foldLeft(Tags(Nil)): (newTags, tag) =>
      if !chapter.tags.value.has(tag) then newTags + tag
      else newTags
    val newEndTag = (
      game.points.isDefined &&
        gameTags(_.Result).isEmpty &&
        !chapter.tags(_.Result).has(game.showResult)
    ).option(Tag(_.Result, game.showResult))
    val tags = newEndTag.fold(gameTags)(gameTags + _)
    val chapterNewTags = tags.value
      .filterNot: tag =>
        tagManualOverride.exists(chapter.id, tag.name)
      .foldLeft(chapter.tags): (chapterTags, tag) =>
        StudyPgnTags(chapterTags + tag)
      .pipe: tags =>
        def fewMoves = Seq(chapter.root, game.root).forall(_.mainline.sizeIs < 2)
        RelayGame.toggleUnplayedTermination(tags, lila.study.StudyPgnTags.points(tags).isDefined && fewMoves)
    if chapterNewTags == chapter.tags then fuccess(none -> false)
    else
      if vs(chapterNewTags) != vs(chapter.tags) then
        logger.info(s"Update ${showSC(study, chapter)} tags '${vs(chapter.tags)}' -> '${vs(chapterNewTags)}'")
      val newName = Chapter.nameFromPlayerTags(game.tags)
      for
        _ <- studyApi.setTagsAndRename(
          studyId = study.id,
          chapterId = chapter.id,
          tags = chapterNewTags,
          newName = newName.filter(_ != chapter.name)
        )(who(chapter.ownerId))
        newEnd = lila.study.StudyPgnTags.points(chapter.tags).isEmpty && lila.study.StudyPgnTags
          .points(tags)
          .isDefined
        _ <- newEnd.so(onChapterEnd(tour, study, chapter))
      yield (tags.some, newEnd)

  private def onChapterEnd(tour: RelayTour, study: Study, chapter: Chapter): Funit =
    for _ <- chapterRepo.setRelayPath(chapter.id, UciPath.root)
    yield
      if tour.official && !study.isMember(UserId("no-analysis")) then
        scheduler.scheduleOnce(5.seconds):
          studyApi.analysisRequest(study.id, chapter.id, study.ownerId, official = true)

  private def makeRelayFor(game: RelayGame, path: UciPath)(using tour: RelayTour) =
    Chapter.Relay(
      path = path,
      lastMoveAt = path.nonEmpty.option(nowInstant),
      playerIds = chapterPlayerIds(game)
    )

  // we only set the FIDE IDs in official tours
  // because we don't want random users to assign real OTB players to imaginary tournaments
  private def chapterPlayerIds(game: RelayGame)(using tour: RelayTour) = tour.official.so(game.playerIdsPair)

  private def chapterName(game: RelayGame, order: Chapter.Order): StudyChapterName =
    Chapter.nameFromPlayerTags(game.tags) | StudyChapterName(s"Board $order")

  private def createChapter(study: Study, game: RelayGame)(using RelayTour): Fu[Chapter] = for
    order <- chapterRepo.nextOrderByStudy(study.id)
    chapter = Chapter.make(
      studyId = study.id,
      name = chapterName(game, order),
      setup = Chapter.Setup(none, Side.Red),
      root = game.root,
      tags = game.tags,
      order = order,
      ownerId = study.ownerId,
      practice = false,
      gamebook = false,
      conceal = none,
      relay = makeRelayFor(game, game.root.mainlinePath).some
    )
    _ <- studyApi.doAddChapter(study, chapter, sticky = false, who(study.ownerId))
  yield chapter

  private val moveOpts = MoveOpts(
    sticky = false,
    promoteToMainline = true
  )

  private val sri = Sri("")
  private def who(userId: UserId) = Who(userId, sri)

  private def vs(tags: Tags) = s"${tags("Red") | "?"} - ${tags("Black") | "?"}"

  private def showSC(study: Study, chapter: Chapter) =
    s"#${study.id} ${chapter.name}"

sealed trait SyncResult:
  val reportKey: String
object SyncResult:
  case class Ok(chapters: List[ChapterResult], plan: RelayUpdatePlan.Plan) extends SyncResult:
    def nbMoves = chapters.foldLeft(0)(_ + _.newMoves)
    def hasMovesOrTags = chapters.exists(c => c.newMoves > 0 || c.tagUpdate)
    val reportKey = "ok"
  case object Timeout extends Exception with SyncResult with util.control.NoStackTrace:
    val reportKey = "timeout"
    override def getMessage = "In progress..."
  case class Error(msg: String) extends SyncResult:
    val reportKey = "error"

  case class ChapterResult(id: StudyChapterId, tagUpdate: Boolean, newMoves: Int, newEnd: Boolean)

  def roundBusChannel(roundId: RelayRoundId) = s"relaySyncResult:$roundId"
  def groupBusChannel(groupId: RelayGroupId) = s"relaySyncResult:$groupId"
