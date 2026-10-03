package lila.relay

import lila.core.playerDirectory.{ Federation, PlayerId }
import chess.format.pgn.{ Tags, Tag }
import lila.study.StudyPgnTags

class NativePlayerOverridesTest extends munit.FunSuite:
  given Federation.Guess = value => Some(Federation.Id(value))

  test("native Unicode overrides preserve explicit ratings and namespaced identity"):
    val overrides = RelayPlayersTextarea("许银川 / wxf:IGM0012 / IGM / 2600 / Xu Yinchuan / CHN")
    assert(overrides.validation.isRight)
    val (tags, ambiguous) = overrides.parse.update(Tags(List(Tag("Red", "许银川"))))
    assertEquals(StudyPgnTags.playerIds(tags).red, PlayerId.parse("wxf:IGM0012"))
    assertEquals(tags("RedElo"), Some("2600"))
    assertEquals(tags("Red"), Some("Xu Yinchuan"))
    assertEquals(ambiguous, Nil)

  test("invalid fields and resource excesses are explicit errors"):
    List("Name / 123456", "Name / wxf:IGM0012 / WGM", "Name / / / invalid", "Name\nName")
      .foreach(text => assert(RelayPlayersTextarea(text).validation.isLeft))
    assert(RelayPlayersTextarea((1 to 1001).map(n => s"Player$n").mkString("\n")).validation.isLeft)

  test("native lookup opt-out is a named property, not a fake player identifier"):
    val (tags, _) = RelayPlayersTextarea("Club Player / - / / 1900").parse
      .update(Tags(List(Tag("Red", "Club Player"))))
    assertEquals(tags("RedDirectoryLookup"), Some("none"))
    assertEquals(StudyPgnTags.playerIds(tags).red, None)
