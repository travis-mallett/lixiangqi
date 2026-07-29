package lila.study

import chess.format.UciPath
import chess.format.pgn.{ Tag, TagType, Tags }
import chess.variant.Variant
import chess.FideId
import lila.tree.Clock

private case class SetTag(chapterId: StudyChapterId, name: String, value: String):
  def validate = StudyPgnTags.validate(name, value)

case class AfterSetTagOnRelayChapter(chapterId: StudyChapterId, tag: Tag)

object StudyPgnTags:

  private def customType(name: String): TagType = Tag(name, "").name

  val Red = customType("Red")
  val RedElo = customType("RedElo")
  val RedTitle = customType("RedTitle")
  val RedTeam = customType("RedTeam")
  val RedFideId = customType("RedFideId")
  val RedClock = customType("RedClock")

  private val redToWhite: Map[TagType, TagType] = Map(
    Red -> Tag.White,
    RedElo -> Tag.WhiteElo,
    RedTitle -> Tag.WhiteTitle,
    RedTeam -> Tag.WhiteTeam,
    RedFideId -> Tag.WhiteFideId,
    RedClock -> Tag.WhiteClock
  )
  private val whiteToRed = redToWhite.map(_.swap)

  def apply(tags: Tags): Tags =
    tags.pipe(filterRelevant(Set.empty)).pipe(removeContradictingTermination).pipe(sort)

  def withRelevantTags(tags: Tags, types: Set[TagType], variant: Variant): Tags =
    val allExtra = types ++
      variant.standard.not.so(Set(Tag.Variant)) ++
      variant.standardInitialPosition.not.so(Set(Tag.FEN))
    tags.pipe(filterRelevant(allExtra)).pipe(removeContradictingTermination).pipe(sort)

  def setRootClockFromTags(c: Chapter): Option[Chapter] =
    val centis = c.tags.timeControl.map: c =>
      c.limit + c.increment
    val clock = centis.map(Clock(_, true.some))
    c.updateRoot:
      _.setClockAt(clock, UciPath.root)
    .filter(c !=)

  // clean up tags before exposing them
  def cleanUpForPublication(tags: Tags) = tags.map:
    _.flatMap: tag =>
      val published = whiteToRed.get(tag.name).fold(tag)(name => tag.copy(name = name))
      published match
        // We need fideId=0 to know that the player really doesn't have one,
        // and that we shouldn't alert about it or try to fix it. But we don't
        // want to publish it.
        case Tag(RedFideId | Tag.BlackFideId, "0") => none
        case _ => published.some

  def validate(name: String, value: String): Option[Tag] = for
    tpe <- relevantTypesByLowercase.get(name.toLowerCase)
    cleaned = lila.common.String.fullCleanUp(value)
    if cleaned.length <= 140
  yield Tag(tpe, cleaned)

  def validateTagTypes(tags: Tags): Either[String, Tags] =
    tags.value
      .collectFirst:
        case t if !relevantTypeSet(t.name) => s"Unknown tag type: ${t.name}"
      .match
        case Some(err) => Left(err)
        case None => Right(apply(tags))

  private[study] def fillPlayer(tags: Tags, newTag: Tag)(using
      Executor
  )(using
      getPlayer: lila.core.fide.GetPlayer,
      getFedName: lila.core.fide.Federation.GetName
  ): Fu[Option[Tags]] =
    newFideId(newTag)
      .so: (color, fideId) =>
        getPlayer(fideId).flatMapz: player =>
          for fedName <- player.fed.so(getFedName)
          yield
            val newTags = List(
              Tag(if color.white then "White" else "Black", player.name).some,
              player.title.map { title =>
                Tag(if color.white then "WhiteTitle" else "BlackTitle", title.value)
              },
              fedName.map { fed => Tag(if color.white then "WhiteTeam" else "BlackTeam", fed) }
            ).flatten
            Option(tags ++ Tags(newTags))

  private def newFideId(newTag: Tag): Option[(Color, FideId)] =
    newTag.name
      .match
        case RedFideId | Tag.WhiteFideId => Color.White.some
        case Tag.BlackFideId => Color.Black.some
        case _ => None
      .flatMap(c => FideId.from(newTag.value.toIntOption).map(c -> _))

  private def filterRelevant(extraTypes: Set[TagType])(tags: Tags) =
    normalizeRedAliases(tags).map:
      _.filter: t =>
        (relevantTypeSet(t.name) || extraTypes(t.name)) && !unknownValues(t.value)

  private def normalizeRedAliases(tags: Tags): Tags = tags.map:
    _.map: tag =>
      redToWhite.get(tag.name).fold(tag)(name => tag.copy(name = name))

  private def removeContradictingTermination(tags: Tags) =
    if tags.outcome.isDefined then
      tags.map(_.filterNot: t =>
        t.name == Tag.Termination && t.value.toLowerCase == "unterminated")
    else tags

  val clockTags: Set[TagType] = Set(Tag.WhiteClock, Tag.BlackClock)

  private val unknownValues = Set("", "?", "unknown")

  private val sortedTypes: List[TagType] =
    import Tag.*
    List(
      Red,
      RedElo,
      RedTitle,
      RedTeam,
      RedFideId,
      Black,
      BlackElo,
      BlackTitle,
      BlackTeam,
      BlackFideId,
      TimeControl,
      Date,
      Result,
      Termination,
      Site,
      Event,
      Round,
      Board,
      Annotator,
      GameId
    )

  val typesToString = sortedTypes.mkString(",")

  private val relevantTypeSet: Set[TagType] =
    sortedTypes.toSet ++ redToWhite.values ++ StudyPlayer.country.tagTypes.toList

  private val relevantTypesByLowercase: Map[String, TagType] =
    relevantTypeSet.map(tagType => tagType.toString.toLowerCase -> tagType).toMap

  private val typePositions: Map[TagType, Int] = sortedTypes.zipWithIndex.toMap

  private def sort(tags: Tags) =
    Tags:
      tags.value.sortBy: t =>
        typePositions
          .get(t.name)
          .orElse(whiteToRed.get(t.name).flatMap(typePositions.get))
          .getOrElse(Int.MaxValue)
