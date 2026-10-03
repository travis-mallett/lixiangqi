package lila.study

import org.apache.pekko.stream.scaladsl.*
import play.api.mvc.RequestHeader
import chess.format.pgn.{ PgnStr, Tag, Tags }
import scalalib.StringOps.slug

import lila.tree.Node.{ Shape, Shapes }
import lila.tree.{ Analysis, Node, Branch, Root }
import lila.xiangqi.{ Xiangqi, XiangqiNotation, XiangqiAnnotations }

final class PgnDump(
    chapterRepo: ChapterRepo,
    analyser: lila.tree.Analyser,
    lightUserApi: lila.core.user.LightUserApi,
    net: lila.core.config.NetConfig
)(using Executor):

  import PgnDump.*

  def chaptersOf(study: Study, flags: Chapter => WithFlags): Source[PgnStr, ?] =
    chapterRepo
      .orderedByStudySource(study.id)
      .mapAsync(1)(chapter => ofChapter(study, flags(chapter))(chapter))

  def ofFirstChapter(study: Study, flags: WithFlags): Fu[Option[PgnStr]] =
    chapterRepo
      .firstByStudy(study.id)
      .flatMapz: chapter =>
        ofChapter(study, flags)(chapter).map(some)

  def ofChapter(study: Study, flags: WithFlags)(chapter: Chapter): Fu[PgnStr] =
    (flags.comments && chapter.serverEval.exists(_.done))
      .so(analyser.byId(Analysis.Id(study.id, chapter.id)))
      .map(ofChapter(study, flags)(chapter, _))

  def requestPgnFlags(default: WithFlags = defaultFlags)(using RequestHeader): WithFlags =
    import lila.common.HTTPRequest.{ queryStringBool, queryStringBoolOpt }
    WithFlags(
      comments = queryStringBoolOpt("comments") | default.comments,
      variations = queryStringBoolOpt("variations") | default.variations,
      clocks = queryStringBoolOpt("clocks") | default.clocks,
      orientation = queryStringBoolOpt("orientation") | default.orientation
    )

  private val defaultFlags = WithFlags(
    comments = true,
    variations = true,
    clocks = true,
    orientation = true
  )

  private val fileR = """[\s,]""".r
  private val dateFormatter = java.time.format.DateTimeFormatter.ofPattern("yyyy.MM.dd")

  def ownerName(study: Study) = lightUserApi.sync(study.ownerId).fold(study.ownerId)(_.name)

  def filename(study: Study): String =
    val date = dateFormatter.print(study.createdAt)
    fileR.replaceAllIn(
      if study.isRelay
      then s"lixiangqi_broadcast_${slug(study.name.value)}_$date"
      else s"lixiangqi_study_${slug(study.name.value)}_by_${ownerName(study)}_$date",
      ""
    )

  def filename(study: Study, chapter: Chapter): String =
    val date = dateFormatter.print(chapter.createdAt)
    fileR.replaceAllIn(
      if study.isRelay
      then s"lixiangqi_broadcast_${slug(study.name.value)}_${slug(chapter.name.value)}_$date"
      else
        s"lixiangqi_study_${slug(study.name.value)}_${slug(chapter.name.value)}_by_${ownerName(study)}_$date"
      ,
      ""
    )

  private def makeTags(study: Study, chapter: Chapter)(using flags: WithFlags): Tags =
    flags.updateTags:
      Tags:
        val genTags = List(
          Tag(_.Event, s"${study.name}: ${chapter.name}"),
          Tag(_.Variant, "Xiangqi"),
          Tag("MoveFormat", "WXF"),
          Tag(_.Result, "*") // required for SCID to import
        ) ::: study.isRelay.not.so(
          List(
            Tag("StudyName", study.name),
            Tag("ChapterName", chapter.name),
            Tag("ChapterURL", s"${net.baseUrl}/study/${study.id}/${chapter.id}"),
            Tag(_.Annotator, s"${net.baseUrl}/@/${ownerName(study)}")
          )
        ) ::: (chapter.root.fen.value != Xiangqi.startFen).so(
          List(
            Tag(_.FEN, chapter.root.fen.value),
            Tag("SetUp", "1")
          )
        ) ::: (!chapter.tags.exists(_.Date)).so {
          val dateStr = Tag.UTCDate.format.print(chapter.createdAt)
          List(
            Tag(_.Date, dateStr),
            Tag(_.UTCDate, dateStr),
            Tag(_.UTCTime, Tag.UTCTime.format.print(chapter.createdAt))
          )
        } ::: List(
          flags.orientation.option(Tag("Orientation", chapter.setup.orientation.key)),
          Some(
            Tag(
              "ChapterMode",
              if chapter.isGamebook then "gamebook"
              else if chapter.isPractice then "practice"
              else if chapter.isConceal then "conceal"
              else "normal"
            )
          ),
          chapter.conceal.map(ply => Tag("ConcealPly", ply.value.toString)),
          chapter.description.map(text => Tag("ChapterDescription", text))
        ).flatten
        val owned = Set(
          "fen",
          "variant",
          "moveformat",
          "chaptername",
          "chaptermode",
          "concealply",
          "chapterdescription",
          "orientation"
        )
        genTags
          .foldLeft(chapter.tagsExport.value.filterNot(t => owned(t.name.toString.toLowerCase)).reverse):
            (tags, tag) =>
              if tags.exists(t => tag.name == t.name) && tag.name != Tag.FEN
              then tags
              else tag :: tags
          .reverse

  private def ofChapter(study: Study, flags: WithFlags)(
      chapter: Chapter,
      analysis: Option[Analysis]
  ): PgnStr =
    val tags = makeTags(study, chapter)(using flags)
    val evaluations = analysis
      .filter(a => chapter.root.gameAt(chapter.root.mainlinePath).exists(_.position == a.position))
      .toList
      .flatMap(_.infos)
      .map(info => info.ply -> info.eval)
      .toMap
    val root = chapter.root.copy(children =
      chapter.root.children.updateMainline(node =>
        node.copy(eval = node.eval.orElse(evaluations.get(node.ply)))
      )
    )
    rootToPgn(root, tags)(using flags)

object PgnDump:

  case class WithFlags(
      comments: Boolean,
      variations: Boolean,
      clocks: Boolean,
      orientation: Boolean,
      updateTags: Update[Tags] = identity
  )
  val fullFlags = WithFlags(true, true, true, true)
  val withoutOrientation = fullFlags.copy(orientation = false)

  def rootToPgn(root: Root, tags: Tags)(using flags: WithFlags): PgnStr =
    def annotations(node: Node): XiangqiAnnotations.Parsed = XiangqiAnnotations.Parsed(
      comments = if flags.comments then node.comments.value.map(_.toAnnotation).toVector else Vector.empty,
      shapes = if flags.comments then node.shapes.value.toVector else Vector.empty,
      study = Option.when(
        flags.comments && (node.forceVariation || node.gamebook.nonEmpty || node.comp || node.clock
          .exists(_.trust.contains(false)))
      )(XiangqiAnnotations.Study(node.forceVariation, node.gamebook, node.comp, node.clock.flatMap(_.trust))),
      clock = Option.when(flags.clocks)(node.clock).flatten.map(_.centis.value),
      elapsed = Option.when(flags.clocks)(node.elapsed).flatten.map(_.value),
      evaluation = Option
        .when(flags.comments)(node.eval)
        .flatten
        .flatMap(e =>
          Option.when(!e.isEmpty)(
            XiangqiAnnotations.Evaluation(e.cp.map(_.value), e.mate.map(_.value), node.evaluationDepth)
          )
        )
    )
    def children(node: Node): Vector[Xiangqi.ImportedTreeNode] =
      val branches = if flags.variations then node.children.toList else node.children.mainlineFirst.toList
      branches.map { branch =>
        Xiangqi.ImportedTreeNode(
          branch.move.uci,
          branch.move.notation,
          branch.move.chineseNotation,
          branch.state,
          children(branch),
          annotations(branch),
          if flags.comments then branch.glyphs.toList.map(_.id).toVector else Vector.empty,
          branch.result
        )
      }.toVector
    PgnStr(
      XiangqiNotation.exportTree(
        Xiangqi.ImportedMoveTree(
          initialFen = root.fen.value,
          headers = tags.value.map(t => t.name.toString.toLowerCase -> t.value).toMap,
          state = root.state,
          children = children(root),
          annotations = annotations(root),
          glyphs = if flags.comments then root.glyphs.toList.map(_.id).toVector else Vector.empty,
          ruleset = root.ruleset
        )
      )
    )
