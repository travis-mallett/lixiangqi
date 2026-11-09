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

## History board alignment — 2026-11-08

Source: website HEAD `486935b00c38e831232b7c1db91f10eeb968e428`, with
`ui/board/css/_graph.scss` SHA-256
`0bdbe9a74e7096ead35238088b82c908010233d02e67abbce6e58400f6df0a00`.
Neither app's checkpoint advances over unrelated concurrent work.

The shared graph board now opts out of flex/grid cross-axis stretching. History
rows can be taller than the board; stretching distorted the artwork before its
rotation, while locations were rotated before scaling. Preserving the board's
aspect ratio keeps those coordinate systems aligned.

- Main mobile: not applicable. Its native profile history filters with
  `supportsNativeGame` in `lib/data/players/player_repository.dart`; the shared
  predicate in `lib/domain/xiangqi/supported_game.dart` excludes Three Kingdoms.
  It has no CSS graph renderer. The existing variant deferral remains in effect.
- Kids: not applicable. `lib/domain/xiangqi/supported_game.dart` also excludes
  Three Kingdoms. Its Standard Xiangqi board and artwork are unchanged, and
  variants remain explicitly deferred.

Validation: production asset build and all 725 frontend tests passed. The browser
regression checks every graph intersection against the rotated artwork in all
three perspectives, at 1440, 900 and 390px viewport widths; Chromium passed all
three tests. Firefox could not launch in the Windows sandbox. The mobile scanner
was run; existing pending reviews were preserved. Deployment needs only the normal
website asset release, with no migration or native app release.
