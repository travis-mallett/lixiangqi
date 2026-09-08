package lila.web
package ui

import lila.ui.*

import ScalatagsTemplate.{ *, given }

val fideHandbookUrl =
  "https://www.wxf-xiangqi.org/index.php?Itemid=291&id=269&lang=en&option=com_content&view=article"

final class FaqUi(helpers: Helpers, sitePages: SitePages):
  import helpers.{ given, * }
  import trans.faq as trf

  private def cmsPageUrl(key: String) = routes.Cms.lonePage(lila.core.id.CmsPageKey(key))

  private def question(id: String, title: String, answer: Frag*) =
    details(
      st.id := id,
      cls := "question",
      name := "faq"
    )(
      summary(span(title)),
      div(cls := "answer")(answer)
    )

  def apply(using Context) =
    sitePages
      .SitePage(
        title = "Frequently Asked Questions",
        active = "faq"
      )
      .css("bits.faq"):
        div(cls := "faq box box-pad")(
          h1(cls := "box__top")(trf.frequentlyAskedQuestions()),
          h2("Lixiangqi"),
          question(
            "name",
            trf.whyIsLichessCalledLichess.txt(),
            p(
              trf.lichessCombinationLiveLightLibrePronounced(em(trf.leechess())),
              " ",
              a(href := "https://www.youtube.com/watch?v=KRpPqcrdE-o")(trf.hearItPronouncedBySpecialist())
            ),
            p(
              trf.whyLiveLightLibre()
            ),
            p(
              trf.whyIsLilaCalledLila(
                a(href := "https://github.com/lichess-org/lila")("lila"),
                a(href := "https://scala-lang.org/")("Scala")
              )
            )
          ),
          question(
            "contributing",
            trf.howCanIContributeToLichess.txt(),
            p(trf.lichessPoweredByDonationsAndVolunteers()),
            p(
              trf.findMoreAndSeeHowHelp(
                a(href := routes.Plan.index())(trf.beingAPatron()),
                a(href := routes.Main.costs)(trf.breakdownOfOurCosts()),
                a(href := routes.Cms.help)(trf.otherWaysToHelp())
              )
            )
          ),
          question(
            "sites_based_on_Lichess",
            trf.areThereWebsitesBasedOnLichess.txt(),
            p(
              trf.yesLichessInspiredOtherOpenSourceWebsites(
                a(href := "/source")(trans.site.sourceCode()),
                a(href := "/api")("API"),
                a(href := routes.GameCatalog.index)(trans.site.database())
              )
            ),
            ul(
              li(a(href := "https://blitztactics.com/about")("Blitz Tactics")),
              li(a(href := "https://tailuge.github.io/chess-o-tron/html/blunder-bomb.html")("Blunder Bomb")),
              li(a(href := "https://lidraughts.org")("lidraughts.org")),
              li(a(href := "https://playstrategy.org")("playstrategy.org")),
              li(a(href := "https://lishogi.org")("lishogi.org"))
            )
          ),
          question(
            "keyboard-shortcuts",
            trf.keyboardShortcuts.txt(),
            p(
              trf.keyboardShortcutsExplanation()
            )
          ),
          h2(trf.fairPlay()),
          question(
            "leaving",
            trf.preventLeavingGameWithoutResigning.txt(),
            p(
              trf.leavingGameWithoutResigningExplanation()
            )
          ),
          question(
            "mod-application",
            trf.howCanIBecomeModerator.txt(),
            p(
              trf.youCannotApply()
            )
          ),
          question(
            "correspondence",
            trf.isCorrespondenceDifferent.txt(),
            p(
              trf.youCanUseOpeningBookNoEngine()
            ),
            p(
              trf.pleaseReadFairPlayPage(a(href := cmsPageUrl("fair-play"))(trf.fairPlayPage()))
            )
          ),
          h2(trf.gameplay()),
          question(
            "acpl",
            trf.whatIsACPL.txt(),
            p(
              trf.acplExplanation()
            )
          ),
          question(
            "timeout",
            trf.insufficientMaterial.txt(),
            p(
              trf.lichessFollowFIDErules(a(href := fideHandbookUrl)(trf.fideHandbook()))
            )
          ),
          question(
            "en-passant",
            trf.discoveringEnPassant.txt(),
            p(
              trf.explainingEnPassant(
                a(href := "https://en.wikipedia.org/wiki/Xiangqi#Rules")(trf.goodIntroduction()),
                a(href := fideHandbookUrl)(trf.fideHandbook()),
                a(href := s"${routes.Learn.index}#/15")(trf.lichessTraining())
              )
            ),
            p(
              trf.watchIMRosenCheckmate(
                a(href := "https://en.wikipedia.org/wiki/Xiangqi#Rules")("generals")
              )
            )
          ),
          question(
            "threefold",
            trf.threefoldRepetition.txt(),
            p(
              trf.threefoldRepetitionExplanation(
                a(href := "https://en.wikipedia.org/wiki/Threefold_repetition")(
                  trf.threefoldRepetitionLowerCase()
                ),
                a(href := fideHandbookUrl)(trf.fideHandbook())
              )
            ),
            h4(trf.notRepeatedMoves()),
            p(
              trf.repeatedPositionsThatMatters(
                em(trf.positions())
              )
            ),
            h4(trf.weRepeatedthreeTimesPosButNoDraw()),
            p(
              trf.threeFoldHasToBeClaimed(
                a(href := routes.Pref.form("game-behavior"))(trf.configure())
              )
            )
          ),
          h2(trf.accounts()),
          question(
            "titles",
            trf.titlesAvailableOnLichess.txt(),
            p(
              trf.lichessRecognizeAllOTBtitles(
                a(href := routes.TitleVerify.index)(
                  trf.asWellAsManyNMtitles()
                )
              )
            ),
            ul(
              li("Grandmaster"),
              li("International Master"),
              li("Xiangqi Master"),
              li("National Master"),
              li("Woman Grandmaster"),
              li("Woman International Master"),
              li("Woman Xiangqi Master"),
              li("Woman National Master")
            ),
            p(
              trf.showYourTitle(
                a(href := routes.TitleVerify.index)(trf.verificationForm()),
                a(href := "#lm")("Lixiangqi Master (LM)")
              )
            )
          ),
          question(
            "lm",
            trf.canIbecomeLM.txt(),
            p(strong(trf.noUpperCaseDot())),
            p(trf.lMtitleComesToYouDoNotRequestIt())
          ),
          question(
            "usernames",
            trf.whatUsernameCanIchoose.txt(),
            p(
              trf.usernamesNotOffensive(
                a(href := cmsPageUrl("username-policy"))(trf.guidelines())
              )
            )
          ),
          question(
            "change-username",
            trf.canIChangeMyUsername.txt(),
            p(trf.usernamesCannotBeChanged.txt())
          ),
          h2("Xiangqi ranks"),
          question(
            "xiangqi-ranks",
            "How does the Lixiangqi rank system work?",
            p(
              "The ranked 15-minute Xiangqi room uses the native 学, 业, and 专 rank ladder. " +
                "Players begin at -160 points (学1-3); the public site presents the rank title rather than the point total."
            ),
            p(
              "A game between players in the same rank moves 10 points. Against an adjacent rank, " +
                "the lower-ranked player gains 15 for an upset or loses 5 to the favorite. The score cannot fall below -250."
            )
          ),
          question(
            "ranked-games",
            "Which games affect my rank?",
            p("Only games entered through the ranked 15-minute room affect Xiangqi rank."),
            p(
              "Challenges, custom and correspondence games, rematches, AI games, API games, and tournaments are casual."
            )
          ),
          question(
            "leaderboards",
            "How does the leaderboard work?",
            p(
              "There is one ",
              a(href := routes.User.list)("Xiangqi leaderboard"),
              ". Eligible accounts appear after establishing a rank in the ranked room."
            )
          ),
          question(
            "rank-refund",
            "When are Xiangqi rank points restored?",
            p(
              "If an opponent is later confirmed to have violated the Terms of Service, points you lost " +
                "to that opponent in recent ranked games are restored automatically."
            ),
            p(
              "Rank points are not restored for lag, disconnections, or ordinary game outcomes. " +
                "A server restart aborts affected games when possible so no rank change is applied."
            )
          ),
          question(
            "puzzle-rating",
            "Do puzzles use Xiangqi ranks?",
            p("No. Puzzle difficulty and puzzle performance remain an independent Glicko rating system.")
          ),
          h2(trf.howToThreeDots()),
          question(
            "browser-notifications",
            trf.enableDisableNotificationPopUps.txt(),
            p(
              img(
                src := assetUrl("images/connection-info.png"),
                alt := trf.viewSiteInformationPopUp.txt()
              )
            ),
            p(
              trf.lichessCanOptionnalySendPopUps()
            )
          ),
          question(
            "autoplay",
            trf.enableAutoplayForSoundsQ.txt(),
            p(trf.enableAutoplayForSoundsA()),
            h3("Mozilla Firefox (", trf.desktop(), ")"),
            p(trf.enableAutoplayForSoundsFirefox()),
            h3("Google Chrome (", trf.desktop(), ")"),
            p(trf.enableAutoplayForSoundsChrome()),
            h3("Safari (", trf.desktop(), ")"),
            p(trf.enableAutoplayForSoundsSafari()),
            h3("Microsoft Edge (", trf.desktop(), ")"),
            p(trf.enableAutoplayForSoundsMicrosoftEdge())
          ),
          question(
            "make-a-bot",
            "Make a Lixiangqi bot?",
            p("Bot play is not part of the initial Lixiangqi release.")
          ),
          question(
            "stop-chess-addiction",
            trf.stopMyselfFromPlaying.txt(),
            p(
              trf.adviceOnMitigatingAddiction(
                a(href := "https://getcoldturkey.com")("ColdTurkey"),
                a(href := "https://freedom.to")("Freedom"),
                a(href := "https://www.proginosko.com/leechblock")("LeechBlock"),
                a(href := cmsPageUrl("userstyles"))(trf.lichessUserstyles()),
                a(href := cmsPageUrl("userstyles"))(
                  trf.fewerLobbyPools()
                ),
                a(href := "https://icd.who.int/browse/2024-01/mms/en#1448597234")(trf.mentalHealthCondition())
              )
            )
          )
        )
