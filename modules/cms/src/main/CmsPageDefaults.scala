package lila.cms

import java.time.Instant

import lila.core.i18n.defaultLanguage
import lila.core.id.{ CmsPageId, CmsPageKey }

/** English fallbacks for the public pages that every Lixiangqi installation must have.
  *
  * A page stored in the CMS takes precedence, so these defaults can still be translated or replaced through
  * the normal CMS editor.
  */
object CmsPageDefaults:

  private case class DefaultPage(title: String, markdown: String, canonicalPath: String)

  private val pages = Map(
    "about" -> DefaultPage(
      "About Lixiangqi",
      """Lixiangqi is a free/libre, open-source Xiangqi server built for players, learners, teachers, and fans of Chinese chess.
        |
        |You can play live or correspondence games, join [tournaments](/tournament), solve [puzzles](/training), analyse positions with Pikafish, explore games, create collaborative [studies](/study), and watch games and broadcasts. Standard Xiangqi is the site's native game.
        |
        |## Built from Lichess
        |
        |Lixiangqi is a native Xiangqi conversion of [Lila](https://github.com/lichess-org/lila), the software that powers Lichess. It retains Lila's strong foundations for accounts, ratings, accessibility, internationalisation, fair play, studies, broadcasts, and community features while replacing chess-specific game behaviour with Xiangqi rules and tools.
        |
        |We are grateful to the Lichess contributors and to every upstream free-software project whose work makes Lixiangqi possible. Attribution and licence details are maintained in the repository's [copying notice](https://github.com/travis-mallett/lixiangqi/blob/master/COPYING.md).
        |
        |## Free, open, and community-minded
        |
        |Lixiangqi is intended to make high-quality online Xiangqi available without paywalls, advertising, or advertising trackers. The [source code](https://github.com/travis-mallett/lixiangqi) is public, so anyone can inspect it, report problems, propose improvements, or build on it under the applicable free-software licences.
        |
        |A service like this exists because people play, test, translate, moderate, document, design, and develop it. If you would like to help, visit the [source repository](https://github.com/travis-mallett/lixiangqi), read the [contribution guide](https://github.com/travis-mallett/lixiangqi/blob/master/CONTRIBUTING.md), or join the [Lixiangqi Discord](https://discord.gg/wCdGwFyCh).
        |
        |## Links
        |
        |* [GitHub](https://github.com/travis-mallett/lixiangqi)
        |* [Discord](https://discord.gg/wCdGwFyCh)
        |* [API documentation](/api)
        |* [Contact](/contact)
        |""".stripMargin,
      "/about"
    ),
    "tos" -> DefaultPage(
      "Terms of Service",
      """Last updated: July 29, 2026
        |
        |## The short version
        |
        |* Do not cheat or use outside assistance during games where assistance is prohibited.
        |* Treat other players with respect.
        |* Do not abuse accounts, ratings, community tools, APIs, or infrastructure.
        |* Do not post illegal, harmful, or infringing content.
        |* Enjoy Xiangqi.
        |
        |## Agreement
        |
        |These Terms of Service ("Terms") govern your access to and use of lixiangqi.org and the services it provides ("Lixiangqi", the "site", or the "services"). By accessing or using the services, you agree to these Terms and the [Privacy Policy](/privacy). If you do not agree, do not use the services.
        |
        |We may revise these Terms when the service or applicable requirements change. The date above will be updated when that happens. Continued use after a revision means that you accept the revised Terms.
        |
        |## The service
        |
        |Lixiangqi provides online Xiangqi play and related community, learning, analysis, database, broadcast, and developer features. Features may be added, changed, suspended, or removed. Maintenance, technical problems, or events outside our control may interrupt access.
        |
        |The service is provided on an "as is" and "as available" basis. To the maximum extent permitted by law, no warranty is made that it will always be available, error-free, secure, or suitable for a particular purpose. Nothing in these Terms excludes a right or liability that applicable law does not permit us to exclude.
        |
        |## Accounts and security
        |
        |Registration is optional, although some features require an account. You must provide information that is accurate enough to operate and secure your account, keep your credentials confidential, and promptly act if you believe your account has been compromised. You are responsible for activity performed through your account.
        |
        |Do not impersonate another person or organisation, falsely claim a Xiangqi title, or choose a username or profile intended to deceive, abuse, or offend. Do not create accounts to evade a restriction. Multiple accounts are allowed only where there is a legitimate purpose and they are not used to manipulate ratings, pairings, events, moderation, or other users.
        |
        |You must be legally able to agree to these Terms in your jurisdiction. If you are not, a parent, guardian, teacher, or other authorised adult must approve and supervise your use. Adults who create or manage an account for a child are responsible for obtaining any required consent and using the available child-safety settings.
        |
        |## Fair play
        |
        |Play your own games. During a game, you may not receive assistance that the applicable game rules do not allow. Prohibited assistance includes engines, move suggestions from software or another person, automated play, hidden consultation, or using another account to influence a result.
        |
        |For correspondence games, books and opening databases may be used unless an event states otherwise; engines, tablebases that provide moves, and help from another person remain prohibited. Event organisers may publish stricter rules, which become part of the conditions for that event.
        |
        |The following are also prohibited:
        |
        |* boosting or deliberately transferring rating points;
        |* sandbagging or intentionally losing, drawing, or lowering a rating;
        |* arranging results, operating undisclosed shared accounts, or otherwise manipulating competition;
        |* excessive aborting, rage quitting, letting clocks run to annoy an opponent, or other deliberate time wasting;
        |* publicly accusing another player of cheating instead of using the reporting tools; and
        |* evading fair-play restrictions or helping somebody else do so.
        |
        |Automated analysis and assistance are welcome in analysis tools and other places clearly designed for them. They are not welcome in active games unless the rules explicitly say otherwise.
        |
        |## Community conduct
        |
        |Do not use chats, forums, messages, teams, studies, blogs, profile fields, or other community features to harass, threaten, shame, discriminate against, deceive, spam, or exploit people. Sexual content involving minors, credible threats, doxxing, malware, unlawful content, and encouragement of violence or self-harm are prohibited.
        |
        |Disagreement is allowed; targeted abuse is not. Respect other people's privacy and intellectual-property rights. Use the site's report tools rather than organising public accusations or harassment.
        |
        |## Content you submit
        |
        |You retain ownership of content you submit. You are responsible for it and must have the rights needed to share it.
        |
        |By submitting content to public or shared parts of the service, you grant Lixiangqi a worldwide, non-exclusive, royalty-free licence to host, store, reproduce, format, display, and distribute that content as needed to operate, secure, improve, and promote the service. This licence ends when the content is deleted, except where copies must remain for security, legal, backup, or technical reasons, or where other users have already lawfully reused public content. Code contributions and content carrying an explicit licence are governed by that licence instead.
        |
        |We may remove, limit, or preserve access to content when reasonably necessary to enforce these Terms, protect users, comply with law, or operate the service.
        |
        |## APIs, automation, and infrastructure
        |
        |Follow the published [API documentation](/api), rate limits, and access rules. Do not scrape private data, circumvent technical restrictions, overload the service, introduce malicious code, probe systems without authorisation, or use the service to attack Lixiangqi or anybody else.
        |
        |Bots must use designated bot accounts and interfaces. Automated activity must be transparent, must not pretend to be a human player, and must not disrupt games or community features.
        |
        |Responsible security research is welcome when conducted in good faith and reported privately through the [contact page](/contact). Accessing other users' data, degrading the service, or exploiting a vulnerability beyond what is necessary to demonstrate it is not authorised.
        |
        |## Moderation and enforcement
        |
        |We may investigate suspected violations and use automated signals and human review. Measures may include warnings, communication limits, game-result or rating adjustments, event exclusions, separation from general pairing pools, account labels, feature restrictions, account closure, and network or device blocks.
        |
        |The appropriate measure depends on context, severity, history, and risk. We may act without advance notice when needed to protect users or the service. You may use the site's appeal process or [contact page](/contact) to challenge an account action. Abuse of reports or appeals is itself prohibited.
        |
        |## Open-source software and other licences
        |
        |Lixiangqi is free/libre open-source software derived from Lila. The primary server code is distributed under the GNU Affero General Public License, version 3 or later. Individual assets, data sets, engines, libraries, and contributed materials may use different licences or terms. See the repository's [COPYING.md](https://github.com/travis-mallett/lixiangqi/blob/master/COPYING.md) and notices accompanying each component.
        |
        |These Terms govern use of the hosted service. They do not replace or restrict rights granted by an applicable open-source or content licence.
        |
        |## Third-party services
        |
        |The site may link to or interoperate with third-party services. Their terms and privacy practices apply to them, and Lixiangqi is not responsible for their content or availability.
        |
        |## Ending use
        |
        |You may stop using the service at any time and may close your account from [account settings](/account/close). We may suspend or terminate access when you violate these Terms, create risk or legal exposure, or materially harm the service or its users. Provisions that by their nature should survive termination—including licences already granted, disclaimers, and responsibility for past conduct—will survive.
        |
        |## Contact
        |
        |Questions about these Terms can be sent through the [Lixiangqi contact page](/contact).
        |""".stripMargin,
      "/terms-of-service"
    ),
    "privacy" -> DefaultPage(
      "Privacy Policy",
      """Last updated: July 29, 2026
        |
        |Lixiangqi is an online Xiangqi service. This policy explains what personal data the operators of lixiangqi.org collect, why it is used, when it is shared, and the choices available to you.
        |
        |## Our principles
        |
        |Lixiangqi is designed to provide Xiangqi, not to build advertising profiles. We do not sell personal data, serve behavioural advertising, or include third-party advertising trackers. We collect and use data needed to operate, secure, moderate, and improve the service.
        |
        |## Data we collect
        |
        |### When you visit
        |
        |Servers necessarily receive technical information such as your IP address, request time, requested page, browser and device information, referring page, and error or security signals. This information is used to deliver the site, prevent abuse, diagnose failures, and keep the service secure.
        |
        |The site uses essential cookies and browser storage for sessions, preferences, security, and feature state. Blocking them may prevent sign-in or other features from working. Lixiangqi does not use them for third-party behavioural advertising.
        |
        |### When you create and use an account
        |
        |We collect your username, a securely hashed representation of your password, and any email address or other account information you provide. We also store account settings, security events, login sessions, ratings, games, tournament activity, puzzle activity, follows and blocks, reports, moderation history, and other actions needed to provide the features you use.
        |
        |Profile details—such as a biography, location, links, language, real name, or claimed title—are optional unless a particular verification process says otherwise. Information submitted for title or identity verification may include documents or images and is used only for verification, abuse prevention, and related record keeping.
        |
        |### Content and communications
        |
        |We store content you submit, including games, studies, annotations, forum posts, blogs, team content, reports, support requests, public chat, and private messages. Public content is visible to others and may be accessible through public APIs or data exports. Private content is limited according to the feature, but authorised moderators or technical operators may access it when needed for support, safety, abuse investigation, or legal compliance.
        |
        |### Analysis and connected services
        |
        |When you request computer analysis, imports, broadcasts, notifications, email delivery, or another connected feature, the data needed to perform that request may be sent to the relevant worker or service provider. Avoid placing sensitive personal information in game notation, study text, or other material submitted for processing.
        |
        |## Why we use data
        |
        |We process data to:
        |
        |* provide accounts, games, ratings, events, puzzles, studies, communications, and requested features;
        |* authenticate users and protect accounts;
        |* detect cheating, spam, harassment, fraud, attacks, and other violations;
        |* respond to support requests, reports, appeals, and legal obligations;
        |* maintain, debug, measure, and improve performance and accessibility;
        |* send service messages you request or that are important to your account; and
        |* preserve the integrity and historical record of public games and competitions.
        |
        |Depending on where you live, the legal basis may be performance of our agreement with you, our legitimate interests in operating a safe and functional service, your consent, or compliance with law. Where processing is based on consent, you may withdraw that consent for future processing.
        |
        |## What is public
        |
        |Your username, public profile fields, ratings, public games, tournament results, public studies, posts, and other content submitted to public areas can be seen and copied by others. Public game and competition records may remain available after an account is closed because they form part of other users' records and the integrity of the game database.
        |
        |Do not publish personal information that you do not want others to retain. Search engines, archives, API users, or other players may keep copies outside Lixiangqi's control.
        |
        |## When data is shared
        |
        |We may share limited data:
        |
        |* with infrastructure and service providers that host, deliver, secure, analyse, or support the features you request;
        |* with authorised moderators, developers, and support personnel who need it for their role;
        |* publicly, when you use a public feature or API;
        |* with event organisers where needed to administer an event you enter;
        |* when required by law or reasonably necessary to protect rights, safety, users, or the service; or
        |* as part of a reorganisation or transfer of the service, subject to appropriate safeguards.
        |
        |Providers may process data in countries other than your own. Where required, we use appropriate contractual or legal safeguards for those transfers.
        |
        |## Retention
        |
        |We keep personal data only for as long as it serves the purposes described here, including operation, security, dispute resolution, legal compliance, backups, and prevention of repeated abuse.
        |
        |Retention varies by data type. Active account data is normally kept while the account exists. Short-lived session and diagnostic data expires sooner. Security, moderation, transaction, and legal records may be kept longer. Public games and content may be retained or de-identified to preserve shared records, ratings, research value, attribution, and service integrity.
        |
        |Closing an account disables it and begins the applicable deletion or de-identification processes; it does not necessarily erase every public, shared, security, or legally required record immediately.
        |
        |## Your choices and rights
        |
        |You can:
        |
        |* review and change account and profile information in your settings;
        |* download the personal data available through [account data](/account/personal-data);
        |* control optional emails and privacy preferences;
        |* delete content where the relevant feature provides that option;
        |* close your account through [account closure](/account/close); and
        |* ask to access, correct, export, restrict, object to, or erase personal data where applicable law provides that right.
        |
        |Some requests may require verification of your identity. A request may be limited where retaining or processing data is required for security, freedom of expression, another person's rights, legal obligations, or the establishment and defence of legal claims.
        |
        |To make a privacy request or ask a question, use the [contact page](/contact) and clearly describe the request.
        |
        |## Children
        |
        |People who cannot legally consent to data processing or agree to the Terms in their jurisdiction may use Lixiangqi only with appropriate authorisation from a parent, guardian, teacher, or other responsible adult. Adults managing a child's account should enable child-safety settings and avoid adding unnecessary personal information.
        |
        |## Security
        |
        |We use technical and organisational measures intended to protect personal data, including access controls and password hashing. No internet service can guarantee absolute security. Use a unique password, enable two-factor authentication when available, and report suspected account compromise promptly.
        |
        |## Changes to this policy
        |
        |We may update this policy as the service or legal requirements change. We will change the date at the top and, for significant changes, may provide an additional notice on the site.
        |""".stripMargin,
      "/privacy"
    ),
    "source" -> DefaultPage(
      "Source Code",
      """Lixiangqi is free/libre open-source software. You can inspect, download, use, and modify its source code under the licences that apply to each component.
        |
        |## Lixiangqi
        |
        |* [travis-mallett/lixiangqi](https://github.com/travis-mallett/lixiangqi) — the Lixiangqi server, web client, native Xiangqi rules, analysis interface, and deployment tools
        |* [Backend modules](https://github.com/travis-mallett/lixiangqi/tree/master/modules) — Scala
        |* [Frontend modules](https://github.com/travis-mallett/lixiangqi/tree/master/ui) — TypeScript and Sass
        |* [Native Xiangqi rules](https://github.com/travis-mallett/lixiangqi/tree/master/modules/xiangqi) — legality, positions, notation, and game results
        |* [Xiangqi tools and data pipeline](https://github.com/travis-mallett/lixiangqi/tree/master/tools) — import, explorer, validation, and puzzle tooling
        |
        |Bug reports and contributions are welcome through the [GitHub repository](https://github.com/travis-mallett/lixiangqi).
        |
        |## Upstream foundations
        |
        |Lixiangqi is derived from [Lila](https://github.com/lichess-org/lila), the open-source software behind Lichess. Accounts, ratings, tournaments, studies, broadcasts, accessibility, internationalisation, and much of the web platform began as Lila components and continue to benefit from the work of Lichess contributors.
        |
        |Browser analysis uses [Pikafish](https://github.com/official-pikafish/Pikafish), and some Xiangqi client work is derived from [PyChess Variants](https://github.com/gbtami/pychess-variants). The application also incorporates other free-software libraries and assets.
        |
        |## Licences and attribution
        |
        |The primary Lixiangqi and inherited Lila code is available under the GNU Affero General Public License, version 3 or later. Some engines, libraries, fonts, artwork, data, and other assets have separate licences or terms.
        |
        |See [COPYING.md](https://github.com/travis-mallett/lixiangqi/blob/master/COPYING.md) for the authoritative component-by-component attribution and licence notices, and [LICENSE](https://github.com/travis-mallett/lixiangqi/blob/master/LICENSE) for the GNU Affero General Public License.
        |""".stripMargin,
      "/source"
    ),
    "ads" -> DefaultPage(
      "Block ads and trackers",
      """Lixiangqi is free of advertising and third-party advertising trackers. We do not sell your attention or personal data to advertisers.
        |
        |The rest of the web is often different. Advertising and tracking can consume bandwidth and battery, profile your activity across sites, slow pages down, and expose you to deceptive or malicious content. You have the right to decide what your device downloads and displays.
        |
        |## Protect your browser
        |
        |[uBlock Origin](https://github.com/gorhill/uBlock) is a fast, free, open-source content blocker for Firefox and other supported browsers. On Chromium-based browsers where the full extension is unavailable, [uBlock Origin Lite](https://github.com/uBlockOrigin/uBOL-home) provides a Manifest V3 version.
        |
        |Only install extensions from the developer's official links or your browser's verified extension store. Similar names do not guarantee that an extension is trustworthy.
        |
        |## Protect an entire device or network
        |
        |DNS-based tools can block many advertising and tracking domains for apps as well as browsers:
        |
        |* [AdGuard DNS](https://adguard-dns.io/) provides hosted and self-managed options.
        |* [Mullvad DNS](https://mullvad.net/en/help/dns-over-https-and-dns-over-tls) provides public blocking profiles.
        |* [Pi-hole](https://pi-hole.net/) is a free, open-source blocker designed for a home network.
        |
        |DNS blocking complements a browser content blocker, but it cannot remove every ad or page element.
        |
        |## About blocking
        |
        |Blocking unwanted network requests is a practical privacy and security choice. Ads and trackers can make sites slower, disclose browsing behaviour, and sometimes deliver harmful content. Lixiangqi supports your ability to browse the web on your own terms.
        |""".stripMargin,
      "/ads"
    )
  )

  def get(key: CmsPageKey): Option[CmsPage] =
    pages
      .get(key.value)
      .map: page =>
        CmsPage(
          id = CmsPageId(s"built-in-${key.value}"),
          key = key,
          title = page.title,
          markdown = Markdown(page.markdown),
          language = defaultLanguage,
          live = true,
          canonicalPath = page.canonicalPath.some,
          by = UserId.lichess,
          at = Instant.EPOCH
        )
