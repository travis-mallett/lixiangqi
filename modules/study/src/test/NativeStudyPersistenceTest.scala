package lila.study

import scala.concurrent.Await
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.stream.SystemMaterializer
import reactivemongo.api.AsyncDriver
import chess.format.pgn.PgnStr

import lila.core.config.CollName
import lila.db.AsyncColl
import lila.db.dsl.{ *, given }
import lila.tree.Node.{ Comment, Comments, Shapes }
import lila.xiangqi.{ UciPath, Xiangqi, XiangqiAnnotations }

class NativeStudyPersistenceTest extends munit.FunSuite:
  if sys.env.contains("LIXIANGQI_ANALYSIS_TEST_URI") then
    test("targeted Mongo edits preserve branch order, simultaneous annotations, clocks and clones"):
      given Executor = scala.concurrent.ExecutionContext.global
      given system: ActorSystem = ActorSystem("native-study-persistence-test")
      given Scheduler = system.scheduler
      given org.apache.pekko.stream.Materializer = SystemMaterializer(system).materializer
      val driver = new AsyncDriver()
      def waitFor[A](future: Fu[A]): A = Await.result(future, 30.seconds)
      val connection = waitFor(driver.connect(sys.env("LIXIANGQI_ANALYSIS_TEST_URI")))
      val database = waitFor(
        connection.database("native_study_test_" + java.util.UUID.randomUUID().toString.replace("-", ""))
      )
      def coll(name: String) = AsyncColl(CollName(name), () => fuccess(database.collection[Coll](name)))
      val studies = StudyRepo(coll("studies"), coll("chapters"))
      val chapters = ChapterRepo(coll("chapters"), studies)
      val sequencer = StudySequencer(studies, chapters)
      val chapterId = StudyChapterId("chapter1")
      val studyId = StudyId("study001")
      val owner = UserId("owner")
      val contributor = UserId("contributor")
      val reader = UserId("reader")
      val root =
        StudyPgnImport.result(PgnStr("1. i1i2 {[%clk 0:01:00.25]} (1. a1a2) i10i9"), Nil).toOption.get.root
      val chapter = Chapter(
        chapterId,
        studyId,
        StudyChapterName("Native"),
        Chapter.Setup(None, Xiangqi.Side.Red),
        root,
        chess.format.pgn.Tags.empty,
        1,
        owner,
        createdAt = nowInstant
      )
      val study = Study(
        studyId,
        StudyName("Native"),
        StudyMembers(
          Map(
            owner -> StudyMember(owner, StudyMember.Role.Write),
            contributor -> StudyMember(contributor, StudyMember.Role.Write),
            reader -> StudyMember(reader, StudyMember.Role.Read)
          )
        ),
        chapter.initialPosition,
        owner,
        lila.core.study.Visibility.`private`,
        Settings.init,
        Study.From.Scratch,
        Study.Likes(0),
        createdAt = nowInstant,
        updatedAt = nowInstant
      )
      try
        waitFor(studies.insert(study))
        waitFor(chapters.insert(chapter))
        assert(study.canContribute(contributor))
        assert(!study.canContribute(reader))
        assert(study.canView(Some(reader)))
        assert(!study.canView(Some(UserId("outsider"))))
        val promoted = root.children.promoteToMainlineAt(UciPath("a1a2")).get
        waitFor(chapters.setChildren(promoted)(chapter, UciPath.root))
        assertEquals(
          waitFor(chapters.byId(chapterId)).get.root.children.toList.map(_.id.value),
          List("a1a2", "i1i2")
        )
        val path = UciPath("i1i2/i10i9")
        val comment = Comment(
          Comment.Id.make,
          Comment.sanitize("Literal {braces} and i10"),
          Comment.Author.User(contributor, "Contributor")
        )
        val shapes = Shapes(
          List(
            XiangqiAnnotations.Shape
              .Arrow("green", Xiangqi.Square.fromKey("i10").get, Xiangqi.Square.fromKey("i9").get)
          )
        )
        waitFor(
          Future.sequence(
            List(
              sequencer.sequenceStudyWithChapter(studyId, chapterId): current =>
                chapters.setComments(Comments(List(comment)))(current.chapter, path),
              sequencer.sequenceStudyWithChapter(studyId, chapterId): current =>
                chapters.setShapes(shapes)(current.chapter, path)
            )
          )
        )
        val saved = waitFor(chapters.byId(chapterId)).get
        val savedNode = saved.root.nodeAt(path).get
        assertEquals(savedNode.comments.value, List(comment))
        assertEquals(savedNode.shapes, shapes)
        assertEquals(saved.root.nodeAt(UciPath("i1i2")).get.clock.get.centis.value, 6025)
        val clone = saved.copy(id = StudyChapterId("chapter2"), order = 2)
        waitFor(chapters.insert(clone))
        assertEquals(waitFor(chapters.byId(clone.id)).get.root, saved.root)
        val reconnected = ChapterRepo(coll("chapters"), studies)
        assertEquals(waitFor(reconnected.byId(chapterId)).get.root, saved.root)
      finally
        waitFor(database.drop())
        waitFor(driver.close())
        waitFor(system.terminate())
