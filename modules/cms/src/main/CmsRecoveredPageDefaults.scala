package lila.cms

import java.time.Instant

import lila.core.i18n.defaultLanguage
import lila.core.id.{ CmsPageId, CmsPageKey }

/** Built-in Lixiangqi editions of public pages that upstream Lila normally reads from the Lichess CMS.
  *
  * Database-backed CMS pages still take precedence. These editions keep a new Lixiangqi installation complete
  * without requiring a copy of Lichess production content.
  */
object CmsRecoveredPageDefaults:

  private case class DefaultPage(title: String, markdown: String, canonicalPath: String)

  private val pages = Map(
    "what-are-studies" -> DefaultPage(
      "Study Xiangqi, the Lixiangqi way",
      """A study is a saved analysis workspace for learning, teaching, annotating games, and exploring Xiangqi with other people.
        |
        |## More than an analysis board
        |
        |On a normal analysis board you can try moves and ask Pikafish for an evaluation. A study keeps that work:
        |
        |* moves and variations;
        |* comments attached to positions;
        |* arrows, highlighted squares, and annotation symbols;
        |* chapter names, game information, and starting positions; and
        |* study members, permissions, and discussion.
        |
        |Everything is saved on the server, so you can close the page and continue later.
        |
        |## Work together in real time
        |
        |Invite friends, students, or a coach. Members can watch the same position and use the study chat. Contributors can add moves, variations, annotations, and chapters.
        |
        |A **public** study can be read by anyone. An **unlisted** study is available to people who have its link. An **invite-only** study is restricted to its members. The study owner controls who may contribute and which analysis tools are available.
        |
        |## One study, many chapters
        |
        |Each chapter has its own move tree and starting position. Create a chapter from:
        |
        |* the standard Xiangqi starting position;
        |* a position prepared in the board editor;
        |* a Lixiangqi game;
        |* a FEN position; or
        |* an imported game score.
        |
        |Chapters can present normal analysis, hide future moves for recall training, or become interactive lessons.
        |
        |## Xiangqi analysis tools
        |
        |Study chapters use the native Xiangqi board and rules. Depending on the owner's settings, they can include Pikafish evaluation and the Xiangqi opening explorer.
        |
        |## Share and export
        |
        |Every study and chapter has a stable link. A study can be cloned when the owner allows it, embedded in another website, or exported with its variations and comments.
        |
        |[Browse studies](/study) or open the [analysis board](/analysis) and choose **Study** to create one.
        |
        |Studies are free for everyone.
        |""".stripMargin,
      "/study/what-are-studies"
    ),
    "studies-staff-picks" -> DefaultPage(
      "Studies: Staff Picks",
      """The original Lichess page collected exceptional opening, middlegame, endgame, and puzzle studies. This Lixiangqi edition is reserved for excellent native Xiangqi material.
        |
        |## What belongs here
        |
        |Staff picks may include:
        |
        |* annotated master games and historical collections;
        |* opening surveys grounded in Xiangqi positions;
        |* middlegame strategy and attacking themes;
        |* endgame technique;
        |* tactical or interactive lesson collections; and
        |* teaching material that makes especially good use of study chapters.
        |
        |The public study library is new, so the curated list will grow with it. Until then, use [All studies](/study/all/hot) and [Topics](/study/topic) to discover public work.
        |
        |Authors can improve a study's chance of being featured by giving chapters clear names, checking the analysis, citing game sources, and adding useful topic tags.
        |""".stripMargin,
      "/study/staff-picks"
    ),
    "broadcasts" -> DefaultPage(
      "About Lixiangqi broadcasts",
      """Broadcasts present a Xiangqi event as an organised collection of rounds and live or completed games.
        |
        |Organisers can create a broadcast, add rounds, upload game scores, or configure a trusted source that Lixiangqi periodically checks for updates. Viewers can follow games on native Xiangqi boards, open individual games for analysis, and return to completed rounds later.
        |
        |## Good broadcast sources
        |
        |A source should be stable, authorised by the event organiser, and updated without rewriting already published moves. Verify player names, colours, round labels, starting times, results, and board numbers before going live.
        |
        |## Fair play and delay
        |
        |For events where live analysis could reach players, use an appropriate broadcast delay and follow the organiser's device and spectator rules. Do not publish private game feeds without permission.
        |
        |[Browse current broadcasts](/broadcast).
        |""".stripMargin,
      "/broadcast/help"
    ),
    "broadcaster-app" -> DefaultPage(
      "Broadcaster App",
      """Lichess provides a dedicated broadcaster application for chess boards and DGT workflows. That application is not yet a supported Xiangqi ingestion path.
        |
        |For Lixiangqi, create and manage the event through the [broadcast web interface](/broadcast). Rounds can be updated from supported game-score sources or through the Lila-compatible broadcast API.
        |
        |Before a large event, test the complete path with a private round and confirm that Xiangqi moves, player colours, clocks, results, and text encoding arrive correctly.
        |""".stripMargin,
      "/broadcast/app"
    ),
    "api" -> DefaultPage(
      "Lixiangqi HTTP API",
      """Lixiangqi exposes the Lila HTTP API surface adapted to native Xiangqi games. Public endpoints can be read without an account; private actions require an OAuth access token with the appropriate scope.
        |
        |## Start here
        |
        |* `GET /api/status` checks service availability.
        |* `GET /api/player` lists online or selected players.
        |* `GET /api/tournament` lists current tournaments.
        |* `GET /api/broadcast` lists broadcasts.
        |* `GET /api/user/{username}` returns a public user profile as JSON.
        |* `GET /api/games/user/{username}` streams exported games.
        |
        |Send an `Accept` header for the representation you need and identify automated clients with a useful user agent. Streaming endpoints should be consumed incrementally rather than buffered indefinitely.
        |
        |## Authentication and limits
        |
        |Use `Authorization: Bearer YOUR_TOKEN` for OAuth requests. Keep tokens secret, request only the scopes you need, and revoke credentials that may have leaked. Clients must respect response status codes, back off after rate limits, and avoid parallel polling that can be replaced by a stream.
        |
        |Lixiangqi follows Lila's endpoint shapes where they make sense, but chess-specific assumptions do not override Xiangqi rules, positions, notation, or game results. Test integrations against this server before production use.
        |
        |The implementation and route definitions are available in the [Lixiangqi source repository](https://github.com/travis-mallett/lixiangqi).
        |""".stripMargin,
      "/api"
    ),
    "changelog" -> DefaultPage(
      "Lixiangqi changelog",
      """Lixiangqi is developed in public. The complete, authoritative history is the [Git commit log](https://github.com/travis-mallett/lixiangqi/commits/master).
        |
        |Notable areas of ongoing work include native Xiangqi legality and notation, Pikafish analysis, the opening explorer and game catalogue, puzzles, studies, broadcasts, accessibility, translations, and local deployment.
        |
        |For release-level changes, review the repository history and linked pull requests. Report regressions through [GitHub issues](https://github.com/travis-mallett/lixiangqi/issues).
        |""".stripMargin,
      "/changelog"
    ),
    "thanks" -> DefaultPage(
      "Thanks",
      """Lixiangqi exists because many communities share their work.
        |
        |We thank the Lichess contributors for Lila and its years of careful engineering; the Pikafish contributors for the Xiangqi engine; PyChess Variants contributors for earlier Xiangqi client work; translators, testers, moderators, game archivists, tournament organisers, teachers, and everyone who reports a problem or submits an improvement.
        |
        |Licences and component-level attribution are listed in [COPYING.md](https://github.com/travis-mallett/lixiangqi/blob/master/COPYING.md).
        |
        |Most of all, thank you to the players who make a Xiangqi server worth building.
        |""".stripMargin,
      "/thanks"
    ),
    "help" -> DefaultPage(
      "Contribute to Lixiangqi",
      """Lixiangqi welcomes contributions of many kinds.
        |
        |## Code and technical work
        |
        |Browse the [source repository](https://github.com/travis-mallett/lixiangqi), read the [contribution guide](https://github.com/travis-mallett/lixiangqi/blob/master/CONTRIBUTING.md), and open an issue before starting a large change.
        |
        |## Xiangqi knowledge
        |
        |Help verify rules, notation, openings, historical game metadata, puzzle solutions, engine behaviour, and translated terminology. Precise sources and reproducible examples are especially valuable.
        |
        |## Community work
        |
        |Create useful studies, organise tournaments, improve documentation, test accessibility, translate interface text, and welcome new players.
        |
        |Join the [Lixiangqi Discord](https://discord.gg/wCdGwFyCh) to coordinate with the community.
        |""".stripMargin,
      "/help/contribute"
    ),
    "fair-play" -> DefaultPage(
      "Fair play",
      """Play your own games.
        |
        |During rated or competitive games, do not use Pikafish or another engine, receive move suggestions from another person or program, consult a move-producing tablebase, automate moves, manipulate ratings, or arrange results.
        |
        |Opening books and databases may be used only in correspondence games unless an event explicitly says otherwise. Engines remain prohibited in correspondence play.
        |
        |Analysis tools are welcome after a game and in analysis boards, studies, broadcasts, and other places designed for them.
        |
        |Do not publicly accuse another player. Use the [report form](/report) so moderators can review the available evidence. Fair-play enforcement is also governed by the [Terms of Service](/terms-of-service).
        |""".stripMargin,
      "/page/fair-play"
    ),
    "bot-accounts" -> DefaultPage(
      "Bot accounts",
      """A bot account plays through the Board or Bot API and must be clearly identified as automated.
        |
        |Bots must not pretend to be human, use ordinary browser automation to evade API controls, spam challenges, manipulate ratings, or disrupt tournaments. Operators are responsible for rate limits, reconnect behaviour, resignations, draw handling, and keeping credentials private.
        |
        |Before creating a bot, confirm that its Xiangqi engine and move conversion use the same coordinate and rule conventions as Lixiangqi.
        |
        |[Browse bots](/player/bots) and see the [HTTP API overview](/api).
        |""".stripMargin,
      "/page/bot-accounts"
    ),
    "leagues-and-battles" -> DefaultPage(
      "Tournament leagues and team battles",
      """Lixiangqi tournaments use the native Lila tournament system with Xiangqi games, ratings, calendars, and history.
        |
        |Team battles let several teams compete in one arena. Team leaders choose eligible teams and the number of leaders whose scores count. Players join through their team and play under the tournament's clock, rating, and fair-play rules.
        |
        |Recurring leagues can be organised as a sequence of ordinary tournaments with published standings. Explain the schedule, scoring, tie-breaks, eligibility, and dispute process before the first event.
        |
        |[Open Tournaments](/tournament).
        |""".stripMargin,
      "/page/leagues-and-battles"
    ),
    "network-administrators" -> DefaultPage(
      "Allow Lixiangqi assets on your network",
      """If the page header says that Lixiangqi assets are blocked, the HTML reached the server but styles, scripts, fonts, board images, or engine files did not.
        |
        |Allow HTTPS access to `lixiangqi.org` and its configured asset host. Do not rewrite JavaScript or WebAssembly responses, strip required cross-origin headers, or cache versioned assets under a different content type.
        |
        |Browser Pikafish uses WebAssembly and may use shared memory. It requires modern browser support plus the cross-origin isolation headers sent by Lixiangqi.
        |
        |After changing a proxy, firewall, DNS filter, or content filter, clear its cached block response and reload the page. If only one device is affected, test without browser extensions before changing the whole network.
        |""".stripMargin,
      "/page/network-administrators"
    ),
    "rating-systems" -> DefaultPage(
      "Lixiangqi rating systems",
      """Lixiangqi uses Glicko-2 ratings. A rating is an estimate, not a permanent score.
        |
        |Each rating includes a central estimate and a rating deviation that represents uncertainty. New or inactive ratings have greater uncertainty and can move more quickly. Regular play reduces uncertainty.
        |
        |Ratings are separated by speed or competition pool where the site presents separate leaderboards. A rating from another server, federation, or time control is not directly interchangeable.
        |
        |The provisional marker indicates that uncertainty is still high. It disappears after enough relevant results and may return after a long period without games.
        |
        |Ratings are recalculated from results and opponent estimates; moderators may also reverse or adjust results affected by abuse or fair-play violations.
        |""".stripMargin,
      "/page/rating-systems"
    ),
    "username-policy" -> DefaultPage(
      "Username policy",
      """Choose a readable name that does not impersonate another person or organisation and is not abusive, discriminatory, sexually explicit, threatening, deceptive, or intended to advertise spam.
        |
        |Do not claim a Xiangqi title you have not verified. Do not use names that imitate official Lixiangqi staff, moderation, support, or system accounts.
        |
        |A username is a long-lived public identifier used in games, ratings, studies, messages, and event history. Only limited case changes may be available later, so choose carefully.
        |
        |Moderators may close or rename accounts that violate this policy or the [Terms of Service](/terms-of-service).
        |""".stripMargin,
      "/page/username-policy"
    ),
    "userstyles" -> DefaultPage(
      "Custom styles and extensions",
      """Lixiangqi already includes board themes, piece sets, light and dark site themes, sound choices, and accessibility preferences.
        |
        |Third-party styles and browser extensions can change the page after Lixiangqi sends it. They may break controls, expose private page data, alter board coordinates, or stop working after an update.
        |
        |Install extensions only from authors you trust, review the permissions they request, and disable them before reporting a visual or interaction bug. Never paste access tokens or session cookies into a style or extension.
        |
        |If you publish a Lixiangqi-specific tool, state clearly that it is unofficial and document which site version it supports.
        |""".stripMargin,
      "/page/userstyles"
    ),
    "lixiangqi-blog" -> DefaultPage(
      "Lixiangqi posts",
      """Official Lixiangqi release notes and engineering updates are currently published with the project rather than through a seeded system blog account.
        |
        |* [Repository and README](https://github.com/travis-mallett/lixiangqi)
        |* [Commit history](https://github.com/travis-mallett/lixiangqi/commits/master)
        |* [Issue tracker](https://github.com/travis-mallett/lixiangqi/issues)
        |* [Community blogs](/blog/community)
        |
        |This page replaces the Lichess system-account blog link, whose database posts are not part of a clean Lila installation.
        |""".stripMargin,
      "/page/lixiangqi-blog"
    ),
    "learn-from-your-mistakes" -> DefaultPage(
      "Learn from your Xiangqi mistakes",
      """After a game, open the analysis board and request computer analysis. Lixiangqi can mark positions where the evaluation changed sharply.
        |
        |Do not stop at the engine label. Return to the position, hide the continuation, and try to find a stronger move yourself. Compare candidate moves, identify the tactical or strategic reason, and save important positions in a study.
        |
        |Pikafish is a powerful reviewer, but its number is not an explanation. Use variations and comments to record what you missed: king safety, an unprotected piece, a blocked line, a forcing check, a capture sequence, or a plan that failed.
        |
        |[Open the analysis board](/analysis).
        |""".stripMargin,
      "/page/learn-from-your-mistakes"
    ),
    "xiangqi-insights" -> DefaultPage(
      "Xiangqi Insights",
      """Insights explores patterns across your rated Lixiangqi games.
        |
        |Choose a question, a metric, and filters such as colour, result, opponent strength, clock, or date. The result is an aggregate view of your own game history, not a judgment about a single move.
        |
        |Useful questions include whether performance changes by colour, which time controls produce the most time trouble, and how results vary against different rating ranges.
        |
        |Insights requires an account with enough completed games. [Sign in to open Insights](/login?referrer=/insights).
        |""".stripMargin,
      "/page/xiangqi-insights"
    ),
    "streamer-community" -> DefaultPage(
      "Join the Lixiangqi streamer community",
      """Lixiangqi can feature live creators who stream Xiangqi.
        |
        |Use a clear channel description, stream content you have permission to show, follow fair-play rules, and add a visible link back to your Lixiangqi profile. Do not use live engine assistance while playing games where assistance is prohibited.
        |
        |Streamer approval is a community feature, not an endorsement of every statement or external link on a channel. Channels that are inactive, misleading, unsafe, or unrelated to Xiangqi may be removed.
        |
        |[Browse live streamers](/streamer).
        |""".stripMargin,
      "/page/streamer-community"
    ),
    "mobile" -> DefaultPage(
      "Lixiangqi on mobile devices",
      """Lixiangqi is a responsive website and can be used from a modern mobile browser.
        |
        |The official Lichess mobile applications target chess and are not a native Lixiangqi client. Use the website for the Xiangqi board, notation, puzzles, analysis, studies, tournaments, and broadcasts.
        |
        |For quick access, use your browser's **Add to Home Screen** command. Keep the browser updated so WebAssembly analysis, real-time games, and accessibility features work correctly.
        |""".stripMargin,
      "/mobile"
    ),
    "forum-etiquette" -> DefaultPage(
      "Forum etiquette",
      """Discuss ideas, positions, games, and events without attacking the people involved.
        |
        |Stay on topic, avoid duplicate threads and spam, do not publicly accuse players of cheating, and do not post private information. Critique moves and arguments rather than identities. Use the report tools for abuse or fair-play concerns.
        |
        |Posts must also follow the [Terms of Service](/terms-of-service).
        |""".stripMargin,
      "/page/forum-etiquette"
    ),
    "team-etiquette" -> DefaultPage(
      "Team etiquette",
      """Teams may organise players, discussions, tournaments, and shared projects.
        |
        |Team leaders should describe the team's purpose, moderate responsibly, avoid unsolicited invitations, and publish event rules before play starts. Members must follow site-wide conduct and fair-play rules.
        |
        |Do not use teams to coordinate rating manipulation, public accusations, harassment, or spam.
        |""".stripMargin,
      "/page/team-etiquette"
    ),
    "blog-etiquette" -> DefaultPage(
      "Blog etiquette",
      """Publish material you have the right to share, credit sources, and distinguish fact from opinion.
        |
        |Do not use blogs for harassment, public cheating accusations, spam, copied articles, deceptive links, or private information. Images, game annotations, and translations need the same care as prose.
        |
        |Use the report tools for violations and the [Terms of Service](/terms-of-service) for the site-wide rules.
        |""".stripMargin,
      "/page/blog-etiquette"
    ),
    "blog-tips" -> DefaultPage(
      "Tips for a good Xiangqi blog post",
      """Start with a specific title and a short introduction that tells readers what they will learn.
        |
        |Use headings, concise paragraphs, diagrams or embedded studies, and links to the games or sources you discuss. Explain important moves in your own words instead of pasting raw engine output.
        |
        |Preview the post on a narrow screen, check every link, add image descriptions, and proofread player names, notation, colours, dates, and results before publishing.
        |""".stripMargin,
      "/page/blog-tips"
    ),
    "report-faq" -> DefaultPage(
      "Reporting on Lixiangqi",
      """Use the report form for cheating, harassment, spam, impersonation, or other rule violations.
        |
        |Describe the specific behaviour and include the relevant game, message, post, study, team, or tournament link. One clear report is more useful than repeated reports or a public accusation.
        |
        |Moderation decisions use information that may not be visible to the reporter, so individual investigation details are not normally disclosed.
        |
        |[Open the report form](/report).
        |""".stripMargin,
      "/page/report-faq"
    ),
    "event-tips" -> DefaultPage(
      "Tips for running a Lixiangqi tournament",
      """Choose a clock and duration that match the players you expect. Give the event a clear name and publish eligibility, scoring, tie-break, chat, and fair-play rules before it begins.
        |
        |For team battles, confirm the participating teams and number of scoring leaders. For private events, test the entry link with a non-organiser account.
        |
        |Be present while the event runs, answer rules questions consistently, and use the site report tools instead of making public cheating accusations.
        |
        |The canonical released event surface is [Tournaments](/tournament).
        |""".stripMargin,
      "/page/event-tips"
    ),
    "team-battle-faq" -> DefaultPage(
      "Team battle FAQ",
      """A team battle is one tournament shared by several teams. Players represent a team they belong to, while only a configured number of leaders contribute to each team's score.
        |
        |The battle organiser selects eligible teams and scoring settings. Team leaders should share the tournament link with their members and explain any additional eligibility rules.
        |
        |Individual games follow the tournament's normal Xiangqi, clock, rating, and fair-play settings.
        |""".stripMargin,
      "/page/team-battle-faq"
    ),
    "streamer-page-activation" -> DefaultPage(
      "Activate a streamer page",
      """A streamer page connects a Lixiangqi account with a public channel that regularly streams Xiangqi.
        |
        |Complete the requested channel and profile information, make the relationship between the accounts visible, and submit the page for review. Approval may be removed if the channel becomes inactive or no longer follows the streamer and community rules.
        |""".stripMargin,
      "/page/streamer-page-activation"
    ),
    "streaming-fairplay-faq" -> DefaultPage(
      "Streaming and fair play",
      """When streaming your own live game, do not display or receive engine analysis, move suggestions, opening assistance that the game rules forbid, or private spectator information.
        |
        |Use a delay when an organiser requires it. If you analyse games, wait until they are finished or use a clearly separate analysis session.
        |
        |Streamers are responsible for overlays, chat, guests, and tools that may accidentally reveal assistance.
        |""".stripMargin,
      "/page/streaming-fairplay-faq"
    ),
    "kid-mode" -> DefaultPage(
      "Kid mode",
      """Kid mode reduces communication and community exposure for an account used by a child.
        |
        |It limits features such as chat, messages, forums, blogs, and profile content while preserving core Xiangqi play and learning tools. A responsible adult should manage the account, avoid publishing personal information, and review the site's privacy and safety settings.
        |""".stripMargin,
      "/page/kid-mode"
    ),
    "appeal-landing" -> DefaultPage(
      "Appeal an account restriction",
      """Use the appeal form while signed in to the affected account.
        |
        |Explain what happened accurately and concisely. Do not create another account to evade a restriction, send repeated messages, or organise public pressure. Appeals are reviewed using the account history and information available to moderators.
        |""".stripMargin,
      "/page/appeal-landing"
    ),
    "appeal" -> DefaultPage(
      "Appeal guidelines",
      """An appeal is a request for moderators to review an account action.
        |
        |Be honest, address the reason shown on the account, and include new context that may change the decision. Abusive, automated, duplicate, or evasive submissions can delay review.
        |""".stripMargin,
      "/page/appeal"
    ),
    "account-closed-by-teacher" -> DefaultPage(
      "Account closed by a teacher",
      """A teacher-managed account may be closed through the classroom tools.
        |
        |Contact the teacher or organisation that managed the account first. Lixiangqi cannot disclose or override another person's classroom decisions without appropriate account and authority checks.
        |""".stripMargin,
      "/page/account-closed-by-teacher"
    ),
    "communication-guidelines" -> DefaultPage(
      "Communication guidelines",
      """Treat other players as people.
        |
        |Do not harass, threaten, shame, discriminate, solicit personal information, spam, or continue contacting someone who has asked you to stop. Keep disagreements about Xiangqi focused on the position, event, or argument.
        |
        |Block unwanted contact and report serious violations instead of escalating them publicly.
        |""".stripMargin,
      "/page/communication-guidelines"
    ),
    "delete-done" -> DefaultPage(
      "Account deletion requested",
      """Your account deletion request has been recorded.
        |
        |Some public or shared records, including games and tournament results, may remain where needed to preserve other players' records, ratings, service integrity, security, or legal obligations. See the [Privacy Policy](/privacy) for details.
        |""".stripMargin,
      "/page/delete-done"
    ),
    "title-verify-index" -> DefaultPage(
      "Verify a Xiangqi title",
      """Title verification connects a recognised over-the-board Xiangqi title with a Lixiangqi account.
        |
        |Provide the federation or organisation, your public player identifier where available, and the evidence requested by the form. Do not upload unnecessary personal information. A moderator will review whether the title and identity can be verified from an authoritative source.
        |""".stripMargin,
      "/page/title-verify-index"
    ),
    "blind-mode-tutorial" -> DefaultPage(
      "Lixiangqi blind mode",
      """Blind mode presents the site through accessible text controls and semantic page structure.
        |
        |Enable it with the accessibility control at the top of the page. Use your screen reader's heading, landmark, form, table, and link navigation. On analysis and game pages, the keyboard help describes the available move and board commands.
        |
        |Xiangqi coordinates use files `a` through `i` and ranks `0` through `9`; confirm your preferred notation in account settings.
        |""".stripMargin,
      "/page/blind-mode-tutorial"
    )
  )

  def get(key: CmsPageKey): Option[CmsPage] =
    pages
      .get(key.value)
      .map: page =>
        CmsPage(
          id = CmsPageId(s"built-in-recovered-${key.value}"),
          key = key,
          title = page.title,
          markdown = Markdown(page.markdown),
          language = defaultLanguage,
          live = true,
          canonicalPath = page.canonicalPath.some,
          by = UserId.lichess,
          at = Instant.EPOCH
        )
