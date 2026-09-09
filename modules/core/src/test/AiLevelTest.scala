package lila.core.game

import munit.FunSuite

import java.nio.file.{ Files, Path }

class AiLevelTest extends FunSuite:

  private val translationKeys = List(
    "aiLevelNewcomer",
    "aiLevelRookie",
    "aiLevelInitiate",
    "aiLevelElementary",
    "aiLevelIntermediate",
    "aiLevelAdvanced",
    "aiLevelElite",
    "aiLevelMaster",
    "aiLevelGrandmaster"
  )

  test("matches the source translation labels"):
    val translationFile =
      Iterator
        .iterate(Path.of(".").toAbsolutePath.normalize())(_.getParent)
        .takeWhile(_ != null)
        .map(_.resolve("translation/source/site.xml"))
        .find(Files.isRegularFile(_))
        .getOrElse(fail("Could not locate translation/source/site.xml from the test working directory"))
    val source = Files.readString(translationFile)
    val translatedNames = translationKeys.map: key =>
      s"""<string name="$key">([^<]+)</string>""".r
        .findFirstMatchIn(source)
        .map(_.group(1))
        .getOrElse(fail(s"Missing translation key $key in $translationFile"))
    assertEquals(translatedNames, (1 to 9).flatMap(AiLevel.name).toList)

  test("does not assign a product name to unknown ids"):
    assertEquals(AiLevel.name(0), None)
    assertEquals(AiLevel.name(10), None)
    assertEquals(AiLevel.displayName(10), "AI level 10")
