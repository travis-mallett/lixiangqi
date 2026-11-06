# Profile Three Kingdoms preview — 2026-11-05

Source: website HEAD `e7638e024687eb71dff5298ceec9ff6e4eefb229`, with
`app/views/user/show/page.scala` SHA-256
`5ba11e235430adb5451af23b7ee25eed423cffbea434eda51db75ad3ecbed863`.
This narrow review does not advance either mobile checkpoint or certify concurrent edits.

The profile's shared ES module list now initializes Three Kingdoms thumbnails on
both activity and games pages. AJAX navigation and pagination use the renderer's
existing content-loaded subscription. Removing the separate PageModule assignment
also preserves the rating-history chart's page data.

- Main mobile: not applicable. Native profile history filters through
  `lib/data/players/player_repository.dart` and `supportsNativeGame`; Three Kingdoms
  is outside the explicitly deferred variant project. No web module lifecycle exists
  in the Flutter profile.
- Kids: not applicable. Its `lib/domain/xiangqi/supported_game.dart` excludes
  Three Kingdoms, and its native screens do not use website profile modules.
  The existing variant deferral remains unchanged.

Validation: all 20 existing user/Three Kingdoms frontend tests, Scala
`scalafmtCheckAll`, compilation and document formatting pass. No native
code or API contract changed, so native builds are not required. This change needs
normal website deployment; no migration or mobile release is required.
