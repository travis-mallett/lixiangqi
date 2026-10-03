package lila.relay

import lila.xiangqi.Xiangqi.{ Result, GamePoints }
import chess.format.pgn.{ Tag, TagType, Tags }

import lila.study.{ MultiPgn, PgnDump, StudyPgnImport, StudyPgnTags }
import lila.tree.{ Root, Clock }
import lila.core.playerDirectory.PlayerToken

case class RelayGame(
    tags: Tags,
    root: Root,
    points: Option[GamePoints]
):
  override def toString =
    s"RelayGame ${root.mainlineNodeList.size} ${points} ${StudyPgnTags.names(tags)} ${StudyPgnTags.playerIds(tags)}"

  def isEmpty = tags.value.isEmpty && root.children.isEmpty

  def isBye = StudyPgnTags.names(tags).exists(_.exists(_.value.toLowerCase == "bye"))

  def hasMoves = root.children.nonEmpty

  def withoutMoves = copy(root = root.withoutChildren)

  def resetToSetup = withoutMoves.copy(
    tags = tags - Tag.Result,
    points = None
  )

  def playerIdsPair: Option[PairOf[Option[lila.core.playerDirectory.PlayerId]]] =
    StudyPgnTags.playerIds(tags).some.filter(_.exists(_.isDefined)).map(_.toPair)

  def applyTagClocksToLastMoves: RelayGame =
    val clocks = StudyPgnTags.clocks(tags)
    if clocks.forall(_.isEmpty) then this
    else
      val mainlinePath = root.mainlinePath
      val turn = root.lastMainlineNode.state.turn
      val newRoot = List(
        mainlinePath.nonEmpty.option(mainlinePath.parent) -> turn,
        mainlinePath.some -> !turn
      ).flatMap:
        case (Some(path), color) => clocks(color).map(path -> _)
        case _ => none
      .foldLeft(root):
          case (root, (path, centis)) =>
            if root.nodeAt(path).exists(_.clock.isDefined) then root
            else root.setClockAt(Clock(centis, true.some).some, path) | root
      copy(root = newRoot)

  def showResult = GamePoints.show(points)

private object RelayGame:

  val siteDomains = List("lixiangqi.org", "lixiangqi.com")

  type TagNames = List[Tag.type => TagType]
  val eventTags: TagNames = List(_.Event, _.Site)
  val nameTags: TagNames = List(_ => StudyPgnTags.Red, _.Black)
  val playerIdTags: TagNames = List(_ => StudyPgnTags.RedPlayerId, _ => StudyPgnTags.BlackPlayerId)
  val unplayedTag = Tag(_.Termination, "Unplayed")

  def fromChapter(c: lila.study.Chapter) = RelayGame(
    tags = c.tags,
    root = c.root,
    points = c.tags("Result").flatMap(GamePoints.fromResult)
  )

  def fromStudyImport(res: StudyPgnImport.Result): RelayGame =
    val fixedTags = cleanOrRemovePlayerNames:
      // remove wrong ongoing result tag if the board has a mate on it
      if res.root.lastMainlineNode.state.gameResult != Result.Ongoing && res.tags(_.Result).has("*") then
        res.tags.map(_.filter(_ != Tag(_.Result, "*")))
      // normalize result tag (e.g. 0.5-0 ->  1/2-0)
      else
        res.tags.map(_.map: tag =>
          if tag.name == Tag.Result
          then tag.copy(value = GamePoints.show(GamePoints.fromResult(tag.value)))
          else tag)
    .pipe(
      toggleUnplayedTermination(
        _,
        res.tags("Result").flatMap(GamePoints.fromResult).isDefined && res.root.mainline.sizeIs < 2
      )
    )
    RelayGame(
      tags = fixedTags,
      root = res.root,
      points = res
        .tags("Result")
        .flatMap(GamePoints.fromResult)
        .orElse(GamePoints.fromResult(res.root.lastMainlineNode.state.gameResult.key))
    ).applyTagClocksToLastMoves

  private def cleanOrRemovePlayerNames(tags: Tags) = tags.map:
    _.flatMap: tag =>
      if tag.name != StudyPgnTags.Red && tag.name != Tag.Black then tag.some
      else
        val clean = tag.value.trim
        Option.when(clean.nonEmpty && clean != "?" && !clean.equalsIgnoreCase("unknown")):
          tag.copy(value = clean)

  def toggleUnplayedTermination(tags: Tags, set: Boolean) =
    if set
    then tags + unplayedTag
    else tags.map(_.filter(_ != unplayedTag))

  import scalalib.Iso
  val iso: Iso[RelayGames, MultiPgn] =
    import lila.study.PgnDump.WithFlags
    given WithFlags = WithFlags(
      comments = true,
      variations = true,
      clocks = true,
      orientation = false
    )
    Iso[RelayGames, MultiPgn](
      gs =>
        MultiPgn:
          gs.view
            .map(g => PgnDump.rootToPgn(g.root, g.tags))
            .toList
      ,
      mul => RelayFetch.multiPgnToGames.either(mul).fold(e => throw e, identity)
    )

  def filter(onlyRound: Option[Either[String, Int]])(games: RelayGames): RelayGames =
    onlyRound.fold(games):
      case Left(r) => games.filter(_.tags(_.Round).has(r))
      case Right(r) => games.filter(_.tags.roundNumber.has(r))

  // 1-indexed, both inclusive
  case class Slice(from: Int, to: Int)

  object Slices:

    def filterAndOrder(slices: List[Slice])(games: RelayGames): RelayGames =
      if slices.isEmpty then games
      else
        slices
          .foldLeft(Vector.empty[Int]): (acc, slice) =>
            acc ++ (slice.from to slice.to).toVector.filterNot(acc.contains)
          .flatMap(i => games.lift(i - 1))

    // 1-5,12-15,20
    def parse(str: String): List[Slice] = str.trim
      .split(',')
      .toList
      .map(_.trim)
      .flatMap: s =>
        s.split('-').toList.map(_.trim) match
          case Nil => none
          case from :: Nil => from.toIntOption.map(f => Slice(f, f))
          case from :: to :: _ => (from.toIntOption, to.toIntOption).mapN(Slice.apply)

    def show(slices: List[Slice]): String = slices
      .map:
        case Slice(f, t) if f == t => f.toString
        case Slice(f, t) => s"$f-$t"
      .mkString(", ")

    val iso: Iso.StringIso[List[Slice]] = Iso(parse, show)

  opaque type ReorderNames = String
  object ReorderNames extends OpaqueString[ReorderNames]:
    extension (r: ReorderNames)
      def reorder(games: RelayGames): RelayGames =
        r.linesIterator.map(parseLine).toVector match
          case Vector() => games
          case lines =>
            val gamesByToken = tokenizeGamesByPlayers(games)
            val ordered = lines.flatMap: line =>
              line
                .map(gamesByToken.getOrElse(_, Vector.empty))
                .match
                  case List(one) => one
                  case List(w, b) => w.filter(b.contains)
                  case _ => Vector.empty
                .headOption

            val unordered = games.filterNot(g => ordered.contains(g))
            ordered ++ unordered

    private def parseLine(line: String): List[PlayerToken] = // one or two player tokens
      line.split(";", 2).toList.map(_.trim).filter(_.nonEmpty).map(RelayPlayerLine.tokenize.apply)

    private def tokenizeGamesByPlayers(games: RelayGames): Map[PlayerToken, Vector[RelayGame]] =
      val gamesTokens: Vector[(RelayGame, List[PlayerToken])] =
        games.map: g =>
          g -> StudyPgnTags
            .names(g.tags)
            .mapList(_.map(_.value))
            .flatten
            .map(RelayPlayerLine.tokenize.apply)
            .filter(_.nonEmpty)

      gamesTokens
        .flatMap((game, tokens) => tokens.map(_ -> game))
        .groupBy(_._1)
        .toMap
        .view
        .mapValues(_.map(_._2).distinct)
        .toMap
