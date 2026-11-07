package lila.mailer

import scalatags.Text.all.*

import lila.core.config.RouteUrl
import lila.core.i18n.Translate
import lila.core.i18n.I18nKey.emails as trans

/** One set of localized content and destinations for both MIME alternatives. */
private[mailer] object WelcomeEmail:

  def message(username: UserName, email: EmailAddress, routeUrl: RouteUrl)(using
      translate: Translate
  ): Mailer.Message =
    val heading = trans.welcome_subject.txt(username)
    val intro = trans.welcome_intro.txt()
    val closing = trans.welcome_closing.txt()
    val sections = List(
      Section(
        trans.welcome_play.txt(),
        trans.welcome_playTip.txt(),
        List(trans.welcome_play.txt() -> routeUrl(routes.Lobby.home))
      ),
      Section(
        trans.welcome_puzzles.txt(),
        trans.welcome_puzzlesTip.txt(),
        List(trans.welcome_puzzles.txt() -> routeUrl(routes.Puzzle.home))
      ),
      Section(
        trans.welcome_profile.txt(),
        trans.welcome_profileTip.txt(),
        List(
          trans.welcome_editProfile.txt() -> routeUrl(routes.Account.profile),
          trans.welcome_viewProfile.txt() -> routeUrl(routes.User.show(username))
        )
      )
    )
    Mailer.Message(
      to = email,
      subject = heading,
      text = Mailer.txt.addServiceNote(
        (List(heading, intro) ++ sections.map(_.text) :+ closing).mkString("\n\n")
      ),
      htmlBody = Mailer.html
        .emailMessage(
          attr("lang") := translate.lang.code,
          attr("dir") := (if lila.core.i18n.isRightToLeft(translate.lang) then "rtl" else "ltr"),
          h1(style := "margin:0 0 20px;font-size:26px;line-height:1.3;")(heading),
          Mailer.html.pDesc(intro),
          sections.zipWithIndex.map: (section, index) =>
            div(style := "margin-top:28px;")(
              h2(style := "margin:0;font-size:20px;")(section.heading),
              p(section.tip),
              section.links.map: (label, destination) =>
                p(
                  a(
                    href := destination.value,
                    style := (if index == 0 then
                                "display:inline-block;padding:12px 22px;background-color:#71451f;color:#ffffff;border-radius:5px;font-weight:bold;text-decoration:none;"
                              else "color:#71451f;text-decoration:underline;")
                  )(label)
                )
            ),
          p(style := "margin-top:32px;")(closing),
          div(style := "margin-top:28px;padding-top:20px;border-top:1px solid #ded8cf;color:#625d56;")(
            Mailer.html.serviceNote
          )
        )
        .some
    )

  private case class Section(heading: String, tip: String, links: List[(String, Url)]):
    def text = (List(heading, tip) ++ links.map((label, url) => s"$label:\n${url.value}")).mkString("\n\n")
