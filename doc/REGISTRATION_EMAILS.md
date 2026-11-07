# Registration emails

Reviewed November 6, 2026 against website HEAD f3d8e9cca137c47844b3bc16cb1f329a2ea557bd plus this working tree. Unrelated concurrent edits and both mobile checkpoints remain unreviewed and unchanged.

## Implementation

WelcomeEmail owns one set of localized sections and route-generated destinations for HTML and plain text. The shared Mailer owns the inline-styled, image-free email shell and corrected lixiangqi.com service/contact/privacy links. All 94 locales in LangList have their own complete welcome copy, subject and service/contact/privacy footer translations, including Vietnamese, Spanish and both Portuguese variants. Inactive translation catalogs are not treated as supported locales. English fallback remains available for unrelated unfinished site translations, but is not needed for the welcome email. Removed welcome_text from all email catalogs rather than leaving obsolete translations. Corrected the old brand/domain throughout the email catalogs, including confirmation and password reset messages.

Text direction is resolved from the locale rather than the username, using the same shared i18n helper as the website shell. The inherited native-locale direction detection was moved to coreI18n with a thread-safe cache; the web shell keeps the same behavior. The shared email presentation table uses fixed layout so long translated words wrap on narrow screens.

No tracking, remote images, dependency additions at runtime, account changes or migration. The mailer test configuration uses the existing i18n module and existing test libraries only. Standard backend deployment delivers these changes; no deployment tooling changes are needed. No email was sent and no production deployment was performed.

## Both mobile products

- LiXiangQi Mobile: **server inherited**. lib/data/auth/auth_repository.dart calls /api/mobile/auth/register and /api/mobile/auth/google/register. MobileAuth.registrationResult calls Auth.welcome with sendWelcomeEmail=true, which reaches the same AutomaticEmail implementation. Its registration code also inherits the corrected shared plain-text footer through MobileEmailCode. No Dart/API/authentication contract changes or app release needed.
- Xiangqi Kids: **server inherited**, verified through its own lib/data/auth/auth_repository.dart and the same server completion path. The email concerns the shared LiXiangQi account and links to the website; it does not add adult features to the native kids interface. No app release needed.

Native layout ports and Flutter/platform builds are **not applicable** to both apps: neither renders or sends these emails. Backend deployment is the only release dependency. Existing baseline, engine, gameplay and variant queues remain unchanged. Reconciliation scanner run before and after the work; this narrow review does not advance either checkpoint.

## Verification

- Pinned pnpm 11.15.0: install, format, lint, check-format, i18n-file-gen and --check passed. Repeated generation; unchanged generated output confirmed.
- Scala scalafmtAll, scalafmtCheckAll and the complete server compile passed. mailer/test passed all 96 tests; i18n/test passed 8 tests covering 220,480 translations. The email suite exercises every supported locale, checks all 15 required keys in the locale’s own catalog (without English fallback), validates destinations, username escaping, RTL direction and language-code selection. Native-speaker editorial review of every translated sentence has not been performed.
- XML DTD validation: all 6,223 files passed using lxml (xmllint unavailable). bin/trans-lint across all destinations passed with 0 errors and 1,390 pre-existing warnings.
- Production UI asset build passed; all 707 frontend tests passed using node ui/.test/runner.mjs (the ui/test symlink is a text file in this Windows checkout). Windows checks use Git Bash; they do not validate Linux dependencies.
- All 282 generated email preview checks passed in headless Edge at 320, 768 and 1280 pixels across all 94 supported locales. The narrow-screen sweep caught and fixed Gujarati overflow in the shared wrapper. Vietnamese, Spanish, both Portuguese variants and RTL previews are saved in .tools/email-preview. Browser previews do not constitute Gmail/Outlook/Apple Mail delivery tests.
- Full Linux test;stage, Mongo-backed integration suites, CodeQL and live SMTP/client delivery were not run. No commit or push is prepared by this task.

## Working-tree fingerprint

SHA-256 of the sorted manifest, each entry encoded as path + NUL + SHA-256(file bytes) + LF:

7bffab6be42295bf0874b134ba00f17c75caedbce0a614833f5eed2363f5265e

Manifest scope: build.sbt; modules/coreI18n/src/main/i18n.scala; modules/web/src/main/ui/layout.scala; modules/mailer/src/main/{AutomaticEmail,Mailer,WelcomeEmail}.scala; modules/mailer/src/test/{WelcomeEmailTest,EmailTranslations}.scala; translation/source/emails.xml; every translation/dest/emails/*.xml; and translation/dest/site/{cv-CU,fy-NL,gd-GB,jbo-AA,kab-DZ,la-VA,mg-MG,mn-MN,ne-NP,pi-IN,ps-AF,ry-UA,so-SO,sw-KE,tk-TM,ur-PK,zu-ZA}.xml (173 files total). Generated key.scala and i18n.d.ts also include pre-existing concurrent site translation edits, which this email review does not certify.
