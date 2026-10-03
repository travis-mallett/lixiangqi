package lila.relay

import chess.format.pgn.{ PgnStr, Tags }

import lila.core.study.data.StudyChapterName
import lila.study.{ Chapter, MultiPgn }
import lila.tree.Root

private object RelayUpdatePlanFixtures:

  def mkChapter(
      order: Chapter.Order,
      tags: Tags,
      root: Root = Root.default
  ): Chapter =
    Chapter(
      id = StudyChapterId(s"chapterId$order"),
      studyId = StudyId("studyId"),
      name = StudyChapterName(s"chapterName$order"),
      setup = Chapter.Setup(gameId = none, orientation = lila.xiangqi.Xiangqi.Side.Red),
      root = root,
      tags = tags,
      order = order,
      ownerId = UserId("broadcast-owner"),
      createdAt = nowInstant
    )

  def readPgns(pgns: String) = RelayGame.iso.to:
    MultiPgn.split(PgnStr(pgns), Max(64))

  def gameChapters(games: RelayGames) =
    games.zipWithIndex.toList.map: (game, i) =>
      mkChapter(i + 1, game.tags, game.root)

  val initialChapter = mkChapter(1, Tags.empty)

  val games: RelayGames = readPgns("""
[Event "SixDays Budapest June GMA"]
[Site "Budapest"]
[Round "9.1"]
[Red "Banh Gia Huy"]
[Black "Yaniv, Yuval"]
[RedElo "2400"]
[RedTitle "FM"]
[RedPlayerId "fixture:12424714"]
[BlackElo "2335"]
[BlackTitle "FM"]
[BlackPlayerId "fixture:2823900"]

1. c4c5 { [%eval 0.13] } 1... g7g6


[Event "SixDays Budapest June GMA"]
[Site "Budapest"]
[Round "9.2"]
[Red "Ezra Paul Chambers"]
[Black "Panesar Vedant"]
[RedElo "2346"]
[RedTitle "FM"]
[RedPlayerId "fixture:20300204"]
[BlackElo "2460"]
[BlackTitle "FM"]
[BlackPlayerId "fixture:35033018"]

1. e4e5 { [%eval 0.15] [%clk 1:20:10] } 1... c7c6 { [%eval 0.25] [%clk 1:30:56] }


[Event "SixDays Budapest June GMA"]
[Site "Budapest"]
[Round "9.3"]
[Red "Aczel, Gergely"]
[Black "Ramoutar, Alan-Safar"]
[RedElo "2502"]
[RedTitle "GM"]
[RedPlayerId "fixture:727709"]
[BlackElo "2357"]
[BlackTitle "IM"]
[BlackPlayerId "fixture:7704224"]

1. c4c5 { [%eval 0.13] [%clk 1:27:40] } 1... e7e6


[Event "SixDays Budapest June GMA"]
[Site "Budapest"]
[Round "9.4"]
[Red "Berczes, David"]
[Black "Pap, Misa"]
[RedElo "2425"]
[RedTitle "GM"]
[RedPlayerId "fixture:722960"]
[BlackElo "2374"]
[BlackTitle "GM"]
[BlackPlayerId "fixture:921610"]

1. h1g3 { [%eval 0.14] } 1... h10g8 { [%eval 0.22] }


[Event "SixDays Budapest June GMA"]
[Site "Budapest"]
[Round "9.5"]
[Red "Moksh Amit Doshi"]
[Black "Paszewski, Mateusz"]
[RedElo "2358"]
[RedTitle "IM"]
[RedPlayerId "fixture:25064967"]
[BlackElo "2349"]
[BlackTitle "FM"]
[BlackPlayerId "fixture:1141058"]

1. a4a5 { [%eval 0.16] [%clk 1:27:11] } 1... i7i6 { [%eval 0.5] [%clk 1:30:31] }
""")

  val chapters: List[Chapter] = gameChapters(games)

  object repeatedPairings:
    val games: RelayGames = readPgns("""
[Red "Banh Gia Huy"]
[Black "Yaniv, Yuval"]
[Round "1.1"]

1. c4c5 { [%eval 0.13] } 1... g7g6


[Red "Banh Gia Huy"]
[Black "Yaniv, Yuval"]
[Round "1.2"]

1. e4e5 { [%eval 0.15] [%clk 1:20:10] } 1... c7c6 { [%eval 0.25] [%clk 1:30:56] }


[Red "Banh Gia Huy"]
[Black "Yaniv, Yuval"]
[Round "1.3"]

1. c4c5 { [%eval 0.13] [%clk 1:27:40] } 1... e7e6


[Red "Berczes, David"]
[Black "Pap, Misa"]
[Round "1.1"]

1. h1g3 { [%eval 0.14] } 1... h10g8 { [%eval 0.22] }


[Red "Berczes, David"]
[Black "Pap, Misa"]
[Round "1.2"]

1. a4a5 { [%eval 0.16] [%clk 1:27:11] } 1... i7i6 { [%eval 0.5] [%clk 1:30:31] }
  """)

    val chapters: List[Chapter] = gameChapters(games)

  object switchedBoards:

    val games: RelayGames = readPgns("""
[Red "AAA"]
[Black "BBB"]
[Round "1.1"]

a4a5 a7a6 c4c5 c7c6 e4e5 e7e6 g4g5 g7g6 i4i5 i7i6 b1c3 b10c8


[Red "CCC"]
[Black "DDD"]
[Round "1.2"]

1. e4e5 { [%eval 0.15] [%clk 1:20:10] } 1... c7c6 { [%eval 0.25] [%clk 1:30:56] }


[Red "EEE"]
[Black "FFF"]
[Round "1.3"]

1. c4c5 { [%eval 0.13] [%clk 1:27:40] } 1... e7e6

  """)

    val chapters: List[Chapter] = gameChapters(games)

    val switchedGames = readPgns("""
[Red "EEE"]
[Black "FFF"]
[Round "1.1"]

1. c4c5 { [%eval 0.13] [%clk 1:27:40] } 1... e7e6


[Red "CCC"]
[Black "DDD"]
[Round "1.2"]

1. e4e5 { [%eval 0.15] [%clk 1:20:10] } 1... c7c6 { [%eval 0.25] [%clk 1:30:56] }


[Red "AAA"]
[Black "BBB"]
[Round "1.3"]

a4a5 a7a6 c4c5 c7c6 e4e5 e7e6 g4g5 g7g6 i4i5 i7i6 b1c3 b10c8

  """)
