package lila.tree

import java.nio.charset.StandardCharsets
import java.nio.file.{ Files, Path, StandardOpenOption }
import play.api.libs.json.*
import lila.xiangqi.{ Xiangqi, XiangqiRules }
import lila.xiangqi.XiangqiJson.given

/** One-time offline format conversion. All database backup/write ownership stays in the versioned tool. */
object NativeAnalysisMigration:
  def convert(data: String, initial: Xiangqi.Position): Either[String, String] =
    XiangqiRules
      .game(initial)
      .flatMap: source =>
        val rows = data.split(";", -1).toVector
        if rows.size > source.moves.size then Left("Analysis exceeds the source game history")
        else
          rows.zipWithIndex
            .foldLeft[Either[String, Vector[String]]](Right(Vector.empty)):
              case (acc, (row, index)) =>
                val fields = row.split(",", -1).toVector
                val before = source.copy(
                  moves = source.moves.take(index),
                  wxf = source.wxf.take(index),
                  states = source.states.take(index + 1)
                )
                for
                  converted <- acc
                  _ <- Either.cond(fields.size <= 4, (), s"Invalid analysis field count at ply ${index + 1}")
                  line <- convertLine(before, fields.lift(2).getOrElse(""), fields.lift(3).filter(_.nonEmpty))
                  _ <- fields
                    .lift(3)
                    .filter(_.nonEmpty)
                    .fold[Either[String, Unit]](Right(()))(best =>
                      Xiangqi.Uci
                        .from(best)
                        .flatMap(move =>
                          Either.cond(before.state.legalMoves.contains(move), (), s"Invalid best move: $best")
                        )
                    )
                yield converted :+ (if fields.size >= 3 then
                                      fields.updated(2, line.map(_.value).mkString(" ")).mkString(",")
                                    else row)
            .map(_.mkString(";"))

  private def convertLine(
      before: Xiangqi.Game,
      notation: String,
      best: Option[String]
  ): Either[String, Vector[Xiangqi.Uci]] =
    val tokens = notation.split(' ').filter(_.nonEmpty).toVector
    tokens.zipWithIndex
      .foldLeft[Either[String, Vector[(Xiangqi.Game, Vector[Xiangqi.Uci])]]](
        Right(Vector(before -> Vector.empty))
      ):
        case (acc, (token, index)) =>
          acc.flatMap: branches =>
            val next = branches.flatMap: (game, moves) =>
              XiangqiRules
                .notationCandidates(game, token)
                .toOption
                .toVector
                .flatten
                .filter(move => index != 0 || best.forall(_ == move.value))
                .flatMap: move =>
                  for
                    result <- XiangqiRules.move(game, move).toOption
                    after <- game.applyMove(result).toOption
                  yield after -> (moves :+ move)
            if next.isEmpty then Left(s"No legal interpretation at variation ply ${index + 1}: $token")
            else if next.size > 256 then Left("Analysis notation exceeds the ambiguity search limit")
            else Right(next)
      .flatMap:
        case Vector((_, moves)) => Right(moves)
        case branches =>
          Left(
            s"Analysis variation has ${branches.size} legal interpretations at source ply ${before.state.ply + 1}"
          )

  def main(args: Array[String]): Unit =
    require(args.length == 2, "Usage: NativeAnalysisMigration input.ndjson output.ndjson")
    val input = scala.io.Source.fromFile(args(0), "UTF-8")
    val output =
      Files.newBufferedWriter(Path.of(args(1)), StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW)
    try
      input.getLines().zipWithIndex.foreach { (line, index) =>
        val doc = Json.parse(line)
        val id = (doc \ "id").as[String]
        val position = (doc \ "position").as[Xiangqi.Position]
        val data = convert((doc \ "data").as[String], position)
          .fold(error => throw IllegalArgumentException(s"Analysis $id: $error"), identity)
        val game = XiangqiRules.game(position).fold(error => throw IllegalArgumentException(error), identity)
        output.write(
          Json.stringify(
            Json.obj("id" -> id, "data" -> data, "key" -> lila.xiangqi.XiangqiEvaluation.key(game))
          )
        )
        output.newLine()
        if (index + 1) % 100 == 0 then System.err.println(s"Converted ${index + 1} analyses")
      }
    finally
      input.close()
      output.close()
