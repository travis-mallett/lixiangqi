package lila.study

import lila.xiangqi.UciPath
import lila.xiangqi.XiangqiJson.given
import chess.format.pgn.{ Tag, TagType, Tags }
import chess.{ PlayerName, IntRating, Centis }
import lila.core.playerDirectory.{ PlayerId, PlayerTitle }
import lila.xiangqi.Xiangqi.{ Side, BySide }
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
  val RedPlayerId = customType("RedPlayerId")
  val BlackPlayerId = customType("BlackPlayerId")
  val RedClock = customType("RedClock")

  // External tag spellings are normalized once; all internal participant keys are Red/Black.
  private val externalWhiteNames = Map(
    "white" -> "Red",
    "whiteelo" -> "RedElo",
    "whitetitle" -> "RedTitle",
    "whiteteam" -> "RedTeam",
    "whiteplayerid" -> "RedPlayerId",
    "whiteclock" -> "RedClock",
    "whitecountry" -> "RedCountry"
  )

  def apply(tags: Tags): Tags =
    val normalized = tags.value.map { tag =>
      val name = externalWhiteNames.getOrElse(
        tag.name.toString.toLowerCase,
        relevantTypesByLowercase.get(tag.name.toString.toLowerCase).fold(tag.name.toString)(_.toString)
      )
      Tag(name, tag.value)
    }
    normalized.groupBy(_.name.toString.toLowerCase).foreach { (name, entries) =>
      require(entries.map(_.value).distinct.size == 1, s"Conflicting notation tag: $name")
    }
    normalized.filter(tag => Set("redplayerid", "blackplayerid")(tag.name.toString.toLowerCase)).foreach {
      tag =>
        require(PlayerId.parse(tag.value).isDefined, s"Invalid native player ID: ${tag.value}")
    }
    sort(removeContradictingTermination(Tags(normalized.distinct)))

  def points(tags: Tags): Option[lila.xiangqi.Xiangqi.GamePoints] =
    tags("Result").flatMap(lila.xiangqi.Xiangqi.GamePoints.fromResult)

  def timeControl(tags: Tags): Option[lila.xiangqi.XiangqiClockControl] =
    tags("TimeControl").flatMap(value =>
      lila.xiangqi.XiangqiClockControl
        .parse(value)
        .fold(error => throw IllegalArgumentException(error), identity)
    )

  def clocks(tags: Tags): BySide[Option[Centis]] =
    BySide(side =>
      tags(if side.red then "RedClock" else "BlackClock").map { value =>
        val parsed = lila.xiangqi.XiangqiAnnotations
          .parse(Vector(s"[%clk $value]"))
          .fold(error => throw IllegalArgumentException(error), identity)
        Centis(parsed.clock.get)
      }
    )

  def names(tags: Tags): BySide[Option[PlayerName]] =
    BySide(tags("Red").map(PlayerName.apply), tags("Black").map(PlayerName.apply))
  def ratings(tags: Tags): BySide[Option[IntRating]] =
    BySide(
      tags("RedElo").flatMap(_.toIntOption).map(IntRating.apply),
      tags("BlackElo").flatMap(_.toIntOption).map(IntRating.apply)
    )
  def titles(tags: Tags): BySide[Option[PlayerTitle]] =
    BySide(tags("RedTitle").flatMap(PlayerTitle.get), tags("BlackTitle").flatMap(PlayerTitle.get))
  def teams(tags: Tags): BySide[Option[String]] = BySide(tags("RedTeam"), tags("BlackTeam"))
  def playerIds(tags: Tags): BySide[Option[PlayerId]] =
    BySide(
      tags("RedPlayerId").flatMap(PlayerId.parse),
      tags("BlackPlayerId").flatMap(PlayerId.parse)
    )

  def setRootClockFromTags(c: Chapter): Option[Chapter] =
    val centis = timeControl(c.tags).map(control => Centis(control.initial))
    val clock = centis.map(Clock(_, true.some))
    c.updateRoot:
      _.setClockAt(clock, UciPath.root)
    .filter(c !=)

  def validate(name: String, value: String): Option[Tag] =
    val cleaned = lila.common.String.fullCleanUp(value)
    val semantic = name.toLowerCase match
      case "timecontrol" => lila.xiangqi.XiangqiClockControl.parse(cleaned).isRight
      case "redplayerid" | "blackplayerid" => PlayerId.parse(cleaned).isDefined
      case "result" => lila.xiangqi.Xiangqi.RecordedResult.fromKey(cleaned).isRight
      case "redclock" | "blackclock" =>
        lila.xiangqi.XiangqiAnnotations.parse(Vector(s"[%clk $cleaned]")).isRight
      case _ => true
    Option.when(
      (cleaned.isEmpty || semantic) && name.matches(
        "[A-Za-z][A-Za-z0-9_]*"
      ) && name.length <= 64 && cleaned.length <= 1000
    )(
      Tag(relevantTypesByLowercase.get(name.toLowerCase).fold(name)(_.toString), cleaned)
    )

  def validateTagTypes(tags: Tags): Either[String, Tags] =
    tags.value
      .find(tag => validate(tag.name.toString, tag.value).isEmpty)
      .fold[Either[String, Tags]](Right(apply(tags)))(tag => Left(s"Invalid tag: ${tag.name}"))

  private[study] def fillPlayer(tags: Tags, newTag: Tag)(using
      Executor
  )(using
      getPlayer: lila.core.playerDirectory.GetPlayer,
      getFedName: lila.core.playerDirectory.Federation.GetName
  ): Fu[Option[Tags]] =
    newPlayerId(newTag)
      .so: (color, playerId) =>
        getPlayer(playerId).flatMapz: player =>
          for fedName <- player.fed.so(getFedName)
          yield
            val newTags = List(
              Tag(if color.red then "Red" else "Black", player.name).some,
              player.title.map { title =>
                Tag(if color.red then "RedTitle" else "BlackTitle", title.value)
              },
              fedName.map { fed => Tag(if color.red then "RedTeam" else "BlackTeam", fed) }
            ).flatten
            Option(tags ++ Tags(newTags))

  private def newPlayerId(newTag: Tag): Option[(Side, PlayerId)] =
    newTag.name
      .match
        case RedPlayerId => Side.Red.some
        case BlackPlayerId => Side.Black.some
        case _ => None
      .flatMap(c => PlayerId.parse(newTag.value).map(c -> _))

  private def removeContradictingTermination(tags: Tags) =
    if points(tags).isDefined then
      tags.map(_.filterNot: t =>
        t.name == Tag.Termination && t.value.toLowerCase == "unterminated")
    else tags

  val clockTags: Set[TagType] = Set(RedClock, Tag.BlackClock)

  private val unknownValues = Set("", "?", "unknown")

  private val sortedTypes: List[TagType] =
    import Tag.*
    List(
      Red,
      RedElo,
      RedTitle,
      RedTeam,
      RedPlayerId,
      Black,
      BlackElo,
      BlackTitle,
      BlackTeam,
      BlackPlayerId,
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
    sortedTypes.toSet ++ Set(
      RedClock,
      Tag.BlackClock,
      Tag.FEN,
      Tag.Variant
    ) ++ StudyPlayer.country.tagTypes.toList

  private val relevantTypesByLowercase: Map[String, TagType] =
    relevantTypeSet.map(tagType => tagType.toString.toLowerCase -> tagType).toMap

  private val typePositions: Map[TagType, Int] = sortedTypes.zipWithIndex.toMap

  private def sort(tags: Tags) =
    Tags:
      tags.value.sortBy: t =>
        typePositions
          .get(t.name)
          .getOrElse(Int.MaxValue)
