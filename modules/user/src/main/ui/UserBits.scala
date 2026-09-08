package lila.user
package ui

import lila.ui.*

import ScalatagsTemplate.{ *, given }
import lila.core.relation.Relation

final class UserBits(helpers: Helpers):
  import helpers.*

  def communityMenu(active: String)(using Translate) =
    lila.ui.bits.pageMenuSubnav(
      a(cls := active.active("leaderboard"), href := routes.User.list)(trans.site.leaderboard()),
      a(cls := active.active("tournament"), href := routes.Tournament.leaderboard)(
        trans.arena.tournamentWinners()
      ),
      a(cls := active.active("shield"), href := routes.Tournament.shields)(
        trans.arena.tournamentShields()
      ),
      div(cls := "sep"),
      a(cls := active.active("bots"), href := routes.PlayApi.botOnline)(
        trans.site.onlineBots()
      ),
      div(cls := "sep"),
      a(cls := active.active("fide"), href := addQueryParam(routes.Fide.index().url, "community", "1"))(
        trans.broadcast.fidePlayers()
      )
    )

  def miniClosed(u: User, relation: Option[Relation])(using Translate) = Snippet:
    frag(
      div(cls := "title")(userLink(u, withPowerTip = false)),
      div(style := "padding: 20px 8px; text-align: center")(trans.settings.thisAccountIsClosed()),
      relation
        .exists(!_.isFollow)
        .option(
          a(
            cls := "btn-rack__btn relation-button text aclose",
            title := trans.site.unblock.txt(),
            href := s"${routes.Relation.unblock(u.id)}?mini=1",
            dataIcon := Icon.NotAllowed
          )(trans.site.blocked())
        ),
      relation
        .exists(_.isFollow)
        .option(
          a(
            cls := "btn-rack__btn relation-button text aclose",
            title := trans.site.unfollow.txt(),
            href := s"${routes.Relation.unfollow(u.id)}?mini=1",
            dataIcon := Icon.ThumbsUp
          )(trans.site.following())
        )
    )

  def signalBars(v: Int) = raw:
    val bars = (1 to 4)
      .map: b =>
        s"""<i${if v < b then " class=\"off\"" else ""}></i>"""
      .mkString("")
    val title = v match
      case 1 => "Poor connection"
      case 2 => "Decent connection"
      case 3 => "Good connection"
      case _ => "Excellent connection"
    s"""<signal title="$title" class="q$v">$bars</signal>"""

  object awards:
    def awardCls(t: Trophy) = cls := s"trophy award ${t.kind._id} ${~t.kind.klass}"

    def maybeLink(urlOpt: Option[String]): Tag =
      urlOpt.filter(_.nonEmpty).fold(span)(url => a(href := url))

    def zugMiracleTrophy(t: Trophy) = frag(
      styleTag("""
  .trophy.zugMiracle {
    display: flex;
    align-items: flex-end;
    height: 40px;
    margin: 0 8px!important;
    transition: 2s;
  }
  .trophy.zugMiracle img { height: 60px; }
  @keyframes psyche { 100% { filter: hue-rotate(360deg); } }
  .trophy.zugMiracle:hover {
    transform: translateY(-9px);
    animation: psyche 0.3s ease-in-out infinite alternate;
  }"""),
      maybeLink(t.anyUrl)(awardCls(t), ariaTitle(t.kind.name)):
        img(src := assetUrl("images/trophy/zug-trophy.png"))
    )
