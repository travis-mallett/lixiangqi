package lila.study

import lila.xiangqi.XiangqiGlyph.{ Glyph, Glyphs }

import chess.format.pgn.{ PgnStr, Tag, Tags }
import chess.{ Centis, ErrorStr }
import lila.core.LightUser
import lila.tree.Node.{ Comment, Comments, Shapes }
import lila.tree.{ Branch, Branches, Root, Clock, Eval }
import lila.xiangqi.{ Xiangqi, XiangqiNotation, XiangqiAnnotations }
import lila.xiangqi.Xiangqi.Move

object StudyPgnImport:
  def result(pgn: PgnStr, contributors: List[LightUser]): Either[ErrorStr, Result] =
    if pgn.value.length > 100_000 then Left(ErrorStr("Notation is too large"))
    else
      XiangqiNotation
        .importTree(Xiangqi.NotationImport(notation = pgn.value))
        .left
        .map(ErrorStr.apply)
        .flatMap { imported =>
          scala.util
            .Try {
              val author = imported.headers
                .get("annotator")
                .filter(_.nonEmpty)
                .map: name =>
                  require(name.length <= 150, "Annotator names must contain at most 150 characters")
                  contributors
                    .find(c =>
                      c.id.value.equalsIgnoreCase(name) || c.titleName
                        .equalsIgnoreCase(name) || name.toLowerCase.endsWith(s"/${c.id.value}")
                    )
                    .fold[Comment.Author](Comment.Author.External(name))(c =>
                      Comment.Author.User(c.id, c.titleName)
                    )
              def comments(a: XiangqiAnnotations.Parsed) = Comments(
                a.comments.toList.map(Comment.fromAnnotation(_, author.getOrElse(Comment.Author.Unknown)))
              )
              def eval(a: XiangqiAnnotations.Parsed) = a.evaluation.map(e =>
                Eval(e.cp.map(chess.eval.Eval.Cp.apply), e.mate.map(chess.eval.Eval.Mate.apply), None)
              )
              val tags = StudyPgnTags(Tags(imported.headers.toList.map { (name, value) => Tag(name, value) }))
              val timeControl = StudyPgnTags.timeControl(tags)
              val rootClock = imported.annotations.clock
                .map(c =>
                  Clock(Centis(c), imported.annotations.study.flatMap(_.clockTrust).orElse(Some(true)))
                )
                .orElse(timeControl.map(c => Clock(Centis(c.initial), Some(true))))
              def branch(node: Xiangqi.ImportedTreeNode, clocks: Xiangqi.BySide[Option[Clock]]): Branch =
                val a = node.annotations
                val mover = !node.state.turn
                val clock = a.clock
                  .map(c => Clock(Centis(c), a.study.flatMap(_.clockTrust).orElse(Some(true))))
                  .orElse((clocks(mover), a.elapsed).mapN { (previous, elapsed) =>
                    val remaining =
                      previous.centis - Centis(elapsed) + timeControl
                        .fold(Centis(0))(control => Centis(control.creditAfterMove((node.state.ply + 1) / 2)))
                    require(
                      remaining.value >= 0,
                      s"Elapsed time exceeds available clock after ${node.move.value}"
                    )
                    Clock(remaining, Some(false))
                  })
                val nextClocks = clocks.update(mover, _ => clock)
                Branch(
                  state = node.state,
                  move = Move(node.move, node.notation, node.chineseNotation),
                  result = node.result,
                  gamebook = a.study.flatMap(_.gamebook),
                  forceVariation = a.study.exists(_.forceVariation),
                  comp = a.study.exists(_.computer),
                  children = Branches(node.children.toList.map(branch(_, nextClocks))),
                  comments = comments(a),
                  shapes = Shapes(a.shapes.toList),
                  glyphs = Glyphs.fromIds(node.glyphs),
                  clock = clock,
                  elapsed = a.elapsed.map(Centis.apply),
                  eval = eval(a),
                  evaluationDepth = a.evaluation.flatMap(_.depth)
                )
              val a = imported.annotations
              require(
                !a.study.exists(s => s.forceVariation || s.computer),
                "A root cannot be a forced variation or computer move"
              )
              val root = Root(
                state = imported.state,
                ruleset = imported.ruleset,
                gamebook = a.study.flatMap(_.gamebook),
                children = Branches(imported.children.toList.map(branch(_, Xiangqi.BySide.fill(rootClock)))),
                comments = comments(a),
                shapes = Shapes(a.shapes.toList),
                glyphs = Glyphs.fromIds(imported.glyphs),
                clock = rootClock,
                elapsed = a.elapsed.map(Centis.apply),
                eval = eval(a),
                evaluationDepth = a.evaluation.flatMap(_.depth)
              )
              val mode = imported.headers
                .get("chaptermode")
                .map(value =>
                  ChapterMaker
                    .Mode(value)
                    .getOrElse(throw IllegalArgumentException(s"Invalid chapter mode: $value"))
                )
              val orientation = imported.headers
                .get("orientation")
                .map(value =>
                  Xiangqi.Side
                    .fromKey(value)
                    .fold(error => throw IllegalArgumentException(error), identity)
                )
              val conceal = imported.headers
                .get("concealply")
                .map(value =>
                  value.toIntOption
                    .filter(_ >= root.ply.value)
                    .map(chess.Ply.apply)
                    .getOrElse(throw IllegalArgumentException("Invalid conceal ply"))
                )
              require(
                conceal.isEmpty || mode.contains(ChapterMaker.Mode.Conceal),
                "A conceal ply requires concealed chapter mode"
              )
              Result(
                root,
                tags,
                imported.headers.get("chaptername").map(StudyChapterName.apply),
                ChapterMetadata(mode, orientation, conceal, imported.headers.get("chapterdescription"))
              )
            }
            .toEither
            .left
            .map(error => ErrorStr(error.getMessage))
        }

  case class ChapterMetadata(
      mode: Option[ChapterMaker.Mode],
      orientation: Option[Xiangqi.Side],
      conceal: Option[chess.Ply],
      description: Option[String]
  )
  case class Result(
      root: Root,
      tags: Tags,
      chapterNameHint: Option[StudyChapterName],
      metadata: ChapterMetadata
  )
