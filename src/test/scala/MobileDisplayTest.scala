package controllers

import play.api.mvc.Headers

class MobileDisplayTest extends munit.FunSuite:
  private val optIn = Headers("X-Mobile-Display" -> "1")
  private def display(
      body: String,
      language: String = "en",
      mime: String = "text/html",
      tag: Option[String] = None
  ) =
    MobileDisplay.response(body, mime, language, 300, tag)

  test("only a credential-free guest can opt into a public representation"):
    assert(MobileDisplay.accepts(optIn, true))
    assert(!MobileDisplay.accepts(Headers(), true))
    assert(!MobileDisplay.accepts(optIn, false))
    for name <- List("Authorization", "Cookie") do
      assert(!MobileDisplay.accepts(optIn.add(name -> "present"), true))
    assert(!MobileDisplay.accepts(Headers("X-Mobile-Display" -> "live-refresh"), true))

  test("a conditional hit carries the validator, freshness, audience and language policy"):
    val first = display("post 1")
    val tag = first.header.headers("ETag")
    val hit = display("post 1", tag = Some("W/" + tag + ", \"other\""))
    assertEquals(first.header.status, 200)
    assertEquals(hit.header.status, 304)
    for header <- List("ETag", "Cache-Control", "Vary", "X-Mobile-Display") do
      assertEquals(hit.header.headers(header), first.header.headers(header))
    assert(hit.header.headers("Vary").contains("X-Blog-Language"))
    assertEquals(hit.header.headers("Cache-Control"), "public, max-age=300")

  test("an edit, deletion, reordering, interface language or format yields a fresh body"):
    val rows = "first second"
    val tag = Some(display(rows).header.headers("ETag"))
    for changed <- List("edited second", "first", "second first") do
      assertEquals(display(changed, tag = tag).header.status, 200)
    assertEquals(display(rows, language = "vi", tag = tag).header.status, 200)
    assertEquals(display(rows, mime = "application/json", tag = tag).header.status, 200)
