package lila.ui

import ScalatagsTemplate.*

/** Persistent, server-rendered information outside the interactive tool's mount point. */
object ToolIntro:
  def apply(heading: String, description: String)(links: Frag*): Frag =
    st.section(cls := "tool-intro box box-pad")(
      h1(heading),
      p(description),
      st.nav(links)
    )
