package lila.video

import lila.ui.ScalatagsTemplate.*
import lila.video.ui.VideoSortSelectOption

class VideoSortSelectOptionTest extends munit.FunSuite:
  private val options = List(
    "curated" -> "Recommended",
    "uploaded" -> "Upload date",
    "oldest" -> "Oldest",
    "views" -> "Views",
    "title" -> "Title"
  )

  test("sort options mark only the active order as selected"):
    VideoSort.values.foreach: sort =>
      val selected = options
        .zip(options.map { case (key, text) =>
          VideoSortSelectOption(sort, key, text).render
        })
        .collect { case ((key, _), html) if html.contains("selected=") => key }
      assertEquals(selected, List(sort.key))

  test("a false Boolean selected value remains present in HTML"):
    assertEquals(st.option(st.selected := false).render, "<option selected=\"false\"></option>")
