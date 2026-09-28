package lila.puzzle

import chess.rating.glicko.Glicko
import reactivemongo.api.bson.*
import scala.util.{ Success, Try }

import lila.db.BSON
import lila.db.dsl.{ *, given }
import lila.xiangqi.Xiangqi

private object BsonHandlers:

  import Puzzle.BSONFields.*
  import lila.rating.Glicko.glickoHandler

  private[puzzle] given puzzleReader: BSONDocumentReader[Puzzle] with
    def readDocument(r: BSONDocument) = for
      id <- r.getAsTry[PuzzleId](id)
      gameId <- r.getAsTry[GameId](gameId)
      snapshotDoc <- r.getAsTry[BSONDocument](sourceSnapshot)
      initialFen <- snapshotDoc.getAsTry[String]("initialFen")
      moves <- snapshotDoc
        .getAsTry[Vector[String]]("moves")
        .flatMap: values =>
          values.flatMap(Xiangqi.Uci.from(_).toOption).toVector match
            case parsed if parsed.size == values.size => Success(parsed)
            case _ => handlerBadValue("Invalid source snapshot move list")
      players <- snapshotDoc
        .getAsTry[Vector[BSONDocument]]("players")
        .flatMap: values =>
          values.foldLeft(Try(Vector.empty[Puzzle.SourcePlayer])):
            case (acc, player) =>
              for
                players <- acc
                color <- player.getAsTry[String]("color")
                userId = player.getAsOpt[UserId]("userId")
                name = player.getAsOpt[String]("name")
                rating = player.getAsOpt[Int]("rating")
              yield players :+ Puzzle.SourcePlayer(color, userId, name, rating)
      snapshot = Puzzle.SourceSnapshot(
        initialFen,
        moves,
        players.toVector,
        snapshotDoc.getAsOpt[String]("name"),
        snapshotDoc.getAsOpt[String]("event"),
        snapshotDoc.getAsOpt[String]("sourceUrl"),
        snapshotDoc.getAsOpt[Boolean]("rated"),
        snapshotDoc.getAsOpt[String]("perf")
      )
      sourceDoc <- r.getAsTry[BSONDocument](gameSource)
      sourceType <- sourceDoc.getAsTry[String]("type")
      source <- sourceType match
        case "native" => Success(None)
        case "catalog" =>
          sourceDoc.getAsTry[String]("database").map(db => Some(Puzzle.GameSource.Catalog(db)))
        case _ => handlerBadValue("Invalid source identity")
      _ <-
        if players.size <= 2 && players.map(_.color).distinct.size == players.size && players
            .forall(p => Set("red", "black")(p.color))
        then Success(())
        else handlerBadValue("Invalid source players")
      fen <- r.getAsTry[String](fen)
      lineStr <- r.getAsTry[String](line)
      parsedLine = lineStr.split(' ').toList.flatMap(Xiangqi.Uci.from(_).toOption)
      _ <-
        if parsedLine.size >= 2 && parsedLine.size == lineStr.split(' ').length then Success(())
        else handlerBadValue("Invalid solution line")
      line <- parsedLine.toNel.toTry("Empty move list?!")
      glicko <- r.getAsTry[Glicko](glicko)
      plays <- r.getAsTry[Int](plays)
      vote <- r.getAsTry[Float](vote)
      themes <- r.getAsTry[Set[PuzzleTheme.Key]](themes)
      playbackDoc <- r.getAsTry[BSONDocument]("playback")
      objective <- playbackDoc.getAsTry[String]("objective")
      solutions <- playbackDoc.getAsTry[Vector[Vector[String]]]("solutions")
      _ <-
        if Set("mate", "tactic")(objective) && solutions.headOption.contains(
            parsedLine.tail.map(_.value).toVector
          )
        then Success(())
        else handlerBadValue("Invalid puzzle playback")
      playback = Puzzle.Playback(objective, solutions, playbackDoc.getAsOpt[Int]("startingCp"))
      retiredValue <- r.getAsTry[Boolean](Puzzle.BSONFields.retired)
    yield Puzzle(
      id = id,
      gameId = gameId,
      gameSource = source,
      sourceSnapshot = snapshot,
      fen = fen,
      line = line,
      glicko = glicko,
      plays = plays,
      vote = vote,
      themes = themes.diff(PuzzleTheme.hiddenThemesKey),
      playback = playback,
      retired = retiredValue
    )

  private[puzzle] given roundIdHandler: BSONHandler[PuzzleRound.Id] = tryHandler[PuzzleRound.Id](
    { case BSONString(v) =>
      v.split(PuzzleRound.idSep) match
        case Array(userId, puzzleId) => Success(PuzzleRound.Id(UserId(userId), PuzzleId(puzzleId)))
        case _ => handlerBadValue(s"Invalid puzzle round id $v")
    },
    id => BSONString(id.toString)
  )

  private[puzzle] given BSONHandler[PuzzleRound.Theme] = tryHandler[PuzzleRound.Theme](
    { case BSONString(v) =>
      PuzzleTheme
        .findAny(v.tail)
        .fold[Try[PuzzleRound.Theme]](handlerBadValue(s"Invalid puzzle round theme $v")) { theme =>
          Success(PuzzleRound.Theme(theme.key, v.head == '+'))
        }
    },
    rt => BSONString(s"${if rt.vote then "+" else "-"}${rt.theme}")
  )

  given roundHandler: BSON[PuzzleRound] with
    import PuzzleRound.BSONFields.*
    def reads(r: BSON.Reader) = PuzzleRound(
      id = r.get[PuzzleRound.Id](id),
      win = r.get[PuzzleWin](win),
      fixedAt = r.dateO(fixedAt),
      date = r.date(date),
      vote = r.intO(vote),
      themes = r.getsD[PuzzleRound.Theme](themes)
    )
    def writes(w: BSON.Writer, r: PuzzleRound) =
      $doc(
        id -> r.id,
        win -> r.win,
        fixedAt -> r.fixedAt,
        date -> r.date,
        vote -> r.vote,
        themes -> w.listO(r.themes)
      )

  import PuzzlePath.given
  private[puzzle] given pathIdHandler: BSONHandler[PuzzlePath.Id] = stringIsoHandler

  import PuzzleAngle.given
  private[puzzle] given BSONHandler[PuzzleAngle] = stringIsoHandler
