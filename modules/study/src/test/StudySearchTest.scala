package lila.study

import lila.db.dsl.{ *, given }

class StudySearchTest extends munit.FunSuite:
  test("owner and member filters retain phrases and require every search term"):
    val query = StudySearch.parse("owner:Alice member:BOB \"central cannon\" endgame")
    assertEquals(query.owner, Some("alice"))
    assertEquals(query.member, Some("bob"))
    assertEquals(query.text, "\"central cannon\" \"endgame\"")

  test("owner search does not bypass private-study permissions"):
    val query = StudySearch.parse("owner:alice")
    assertEquals(query.selector(None), $doc("visibility" -> "public", "ownerId" -> "alice"))
    val authenticated = query.selector(Some(UserId("bob")))
    assert(authenticated.getAsOpt[List[Bdoc]]("$or").exists(_.contains($doc("uids" -> UserId("bob")))))
    assertEquals(authenticated.getAsOpt[String]("ownerId"), Some("alice"))

  test("native vocabulary and excluded words remain text, never query fields"):
    val query = StudySearch.parse("中炮 -trap $where:evil")
    assertEquals(query.text, "\"中炮\" -\"trap\" \"$where:evil\"")
    assert(!query.selector(None).contains("$where"))
