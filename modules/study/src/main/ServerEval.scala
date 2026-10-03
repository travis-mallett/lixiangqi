package lila.study

import lila.xiangqi.XiangqiGlyph.{ Glyph, Glyphs }

import chess.format.Fen
import lila.xiangqi.UciPath
import lila.xiangqi.XiangqiJson.given
import lila.xiangqi.Xiangqi.Uci

import play.api.libs.json.*

import lila.core.perm.Granter
import lila.core.relay.GetCrowd
import lila.db.dsl.bsonWriteOpt
import lila.tree.Node.Comment
import lila.tree.{ Advice, Analysis, Branch, Branches, Info, Node, Root }
import lila.xiangqi.{ Xiangqi, XiangqiRules }

object ServerEval:

  final class Requester(
      chapterRepo: ChapterRepo,
      userApi: lila.core.user.UserApi,
      chapterAnalysis: ChapterAnalysis
  )(using Executor):

    private val onceEvery = scalalib.cache.OnceEvery[StudyChapterId](5.minutes)

    def apply(study: Study, chapter: Chapter, userId: UserId, official: Boolean = false): Funit =
      chapterAnalysis(chapter).flatMap: resolved =>
        resolved.sourceGame.isEmpty.so(request(study, chapter, userId, official))

    private def request(study: Study, chapter: Chapter, userId: UserId, official: Boolean): Funit =
      onceEvery(chapter.id).so:
        for
          isOfficial <- fuccess(official) >>|
            fuccess(userId.is(UserId.lichess)) >>|
            userApi.me(userId).map(_.soUse(Granter.opt(_.Relay)))
          _ <- chapterRepo.startServerEval(chapter)
        yield lila.common.Bus.pub(
          lila.core.fishnet.Bus.StudyChapterRequest(
            studyId = study.id,
            chapterId = chapter.id,
            initialFen = chapter.root.fen.some,
            ruleset = chapter.root.ruleset,
            moves = chapter.root.mainline.map(_.move.uci),
            userId = userId,
            official = isOfficial
          )
        )

  final class Merger(
      sequencer: StudySequencer,
      socket: StudySocket,
      chapterRepo: ChapterRepo,
      analyser: lila.tree.Analyser,
      divider: lila.core.game.Divider,
      analysisJson: lila.tree.AnalysisJson
  )(using Executor, Scheduler):

    def apply(analysis: Analysis, complete: Boolean): Funit = analysis.id match
      case Analysis.Id.Study(studyId, chapterId) =>
        sequencer.sequenceStudyWithChapter(studyId, chapterId):
          case Study.WithChapter(_, chapter)
              if chapter.root.gameAt(chapter.root.mainlinePath).exists(_.position == analysis.position) =>
            validateTreeBudget(chapter, analysis)
            for
              retained <-
                if complete then
                  val source = chapter.root.gameAt(chapter.root.mainlinePath).toOption.get
                  analyser.persistStudy(
                    analysis,
                    lila.xiangqi.XiangqiEvaluation
                      .key(source)
                      .getBytes(java.nio.charset.StandardCharsets.UTF_8)
                  )
                else fuccess(analysis)
              _ <- chapter.root.mainline
                .zip(retained.infoAdvices)
                .foldM(UciPath.root):
                  case (path, (node, (info, advOpt))) =>
                    saveAnalysis(chapter, node, path, info, advOpt)
                .logFailure(logger)
              _ <- complete.so(chapterRepo.completeServerEval(chapter))
              _ <- sendProgress(studyId, chapterId, retained)
            yield ()
          case _ => funit
      case _ => funit

    private def saveAnalysis(
        chapter: Chapter,
        node: Branch,
        path: UciPath,
        info: Info,
        advOpt: Option[Advice]
    ): Future[UciPath] =

      val nextPath = path + node.id

      def saveAnalysisLine() =
        chapter.root
          .nodeAt(path)
          .flatMap: parent =>
            analysisLine(chapter.root, path, info).map: subTree =>
              parent.children.get(subTree.id).fold(subTree)(_.merge(subTree))
          .so: subTree =>
            chapterRepo.addSubTree(chapter, subTree, path, none)

      def saveInfoAdvice() =
        import BSONHandlers.given
        import lila.db.dsl.given
        import lila.study.Node.BsonFields as F
        ((info.eval.score.isDefined && node.eval.isEmpty) || (advOpt.isDefined && !node.comments.hasSiteComment))
          .so(
            chapterRepo
              .setNodeValues(
                chapter,
                nextPath,
                List(
                  F.score -> info.eval.score
                    .ifTrue:
                      node.eval.isEmpty ||
                      advOpt.isDefined && node.comments.findBy(Comment.Author.Site).isEmpty
                    .flatMap(bsonWriteOpt),
                  F.comments -> advOpt
                    .map: adv =>
                      node.comments + Comment(
                        Comment.Id.make,
                        adv.makeComment(false),
                        Comment.Author.Site
                      )
                    .flatMap(bsonWriteOpt),
                  F.glyphs -> advOpt
                    .map(adv => node.glyphs.merge(Glyphs.fromList(List(Glyph.fromId(adv.judgment.glyph.id)))))
                    .flatMap(bsonWriteOpt)
                )
              )
          )

      saveAnalysisLine()
        >> saveInfoAdvice().inject(nextPath)

    end saveAnalysis

    private def validateTreeBudget(chapter: Chapter, analysis: Analysis): Unit =
      val (root, _) = chapter.root.mainline
        .zip(analysis.infos)
        .foldLeft(chapter.root -> UciPath.root):
          case ((root, path), (node, info)) =>
            val updated = analysisLine(root, path, info).fold(root): branch =>
              root
                .withChildren(_.addNodeAt(branch, path))
                .getOrElse(throw IllegalArgumentException("Invalid analysis path"))
            updated -> (path + node.id)
      require(root.children.countRecursive <= Chapter.maxNodes, "Analysis exceeds maximum study node count")
      require(root.children.maxDepth <= UciPath.maxDepth, "Analysis exceeds maximum study move depth")

    private def analysisLine(root: Root, path: UciPath, info: Info): Option[Branch] =
      root
        .gameAt(path)
        .flatMap { initial =>
          XiangqiRules.variation(initial, info.variation.take(20).toVector).map { line =>
            line.moves.foldRight(Option.empty[Branch]) { (move, child) =>
              Some(
                Branch(
                  move.state,
                  Xiangqi.Move(move.move, move.notation, move.chineseNotation),
                  children = Branches(child.toList),
                  comp = true
                )
              )
            }
          }
        }
        .fold(
          error => throw IllegalArgumentException(s"Invalid engine line: $error"),
          identity
        )

    private def sendProgress(
        studyId: StudyId,
        chapterId: StudyChapterId,
        analysis: Analysis
    ): Funit =
      chapterRepo
        .byId(chapterId)
        .flatMapz: chapter =>
          reallySendToChapter(studyId, chapter).mapz:
            socket.onServerEval(
              studyId,
              ServerEval.Progress(
                chapterId = chapter.id,
                tree = chapter.root,
                analysis = analysisJson.bothPlayers(chapter.root.ply, analysis),
                division = divisionOf(chapter)
              )
            )

    private def reallySendToChapter(studyId: StudyId, chapter: Chapter): Fu[Boolean] =
      if chapter.relay.isEmpty
      then fuTrue
      else
        lila.common.Bus
          .ask[Int, GetCrowd](GetCrowd(studyId, _))
          .map(_ < 1000)

    def divisionOf(chapter: Chapter) =
      divider(
        id = chapter.id.into(GameId),
        positions = chapter.root.fen.value +: chapter.root.mainline.map(_.fen.value).toVector
      )

  case class Progress(chapterId: StudyChapterId, tree: Root, analysis: JsObject, division: chess.Division)
