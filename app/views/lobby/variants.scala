package views.lobby

import lila.app.UiEnv.{ *, given }
import lila.xiangqi.GameVariant

object variants:

  def apply()(using Context) =
    st.section(cls := "lobby__variants", attr("aria-labelledby") := "lobby-variants-title")(
      h2(id := "lobby-variants-title", cls := "lobby__section-title")(
        span(cls := "lobby__svg-icon lobby__svg-icon--variants", aria.hidden := true),
        trans.site.variants()
      ),
      div(cls := "lobby__variant-list")(
        playable(GameVariant.Jieqi, "jieqi", trans.site.jieqiTitle.txt()),
        playable(GameVariant.Banqi, "banqi", trans.site.banqiTitle.txt()),
        playable(GameVariant.MiniXiangqi, "mini-xiangqi", trans.site.miniXiangqiTitle.txt()),
        h3(cls := "lobby__variant-divider")(trans.site.historicalVariants()),
        playable(GameVariant.ThreeKingdoms, "three-player", s"${trans.site.threeKingdoms.txt()} (三国棋)"),
        playable(GameVariant.Manchu, "manchu", trans.site.manchuTitle.txt()),
        row("other", trans.site.otherVariantsAndGames.txt())(
          a(cls := s"$actionClass lobby__variant-browse", href := routes.Cms.variantHome)(
            iconTag(Icon.List)(aria.hidden := true),
            trans.site.browseAllVariants()
          )
        )
      )
    )

  private val actionClass = "button button-metal lobby__variant-action"

  private def playable(variant: GameVariant, art: String, name: String)(using Context) =
    def shortcut(action: String, label: String, fullLabel: String, icon: Frag) =
      button(
        cls := actionClass,
        tpe := "button",
        attr("data-action") := action,
        disabled,
        title := fullLabel,
        aria.label := fullLabel
      )(icon, span(label))
    row(art, name, Some(variant))(
      shortcut("rated", trans.site.rated.txt(), trans.site.rated.txt(), iconTag(Icon.PlayTriangle)),
      shortcut(
        "ai",
        trans.site.variantBot.txt(),
        trans.site.playAgainstComputer.txt(),
        span(cls := "lobby__svg-icon lobby__svg-icon--computer", aria.hidden := true)
      ),
      shortcut(
        "friend",
        trans.site.challengeAFriend.txt(),
        trans.site.challengeAFriend.txt(),
        iconTag(SvgIcon.Challenge)
      ),
      a(
        cls := actionClass,
        href := s"/analysis/${variant.key}",
        title := trans.site.analysis.txt(),
        aria.label := trans.site.analysis.txt()
      )(
        iconTag(Icon.Microscope),
        span(trans.search.analysis())
      )
    )

  private def row(art: String, name: String, variant: Option[GameVariant] = None)(actions: Frag*) =
    val identity = frag(
      img(
        cls := "lobby__variant-icon",
        src := assetUrl(s"images/homepage/variants/$art.png"),
        alt := "",
        widthA := 44,
        heightA := 44
      ),
      span(id := s"variant-$art")(name)
    )
    val heading = variant.fold[Frag](div(cls := "lobby__variant-name")(identity)): v =>
      a(cls := "lobby__variant-name", href := s"/?variant=${v.key}", attr("data-variant") := v.key)(identity)
    div(cls := "lobby__variant-row", role := "group", attr("aria-labelledby") := s"variant-$art")(
      heading,
      actions
    )
