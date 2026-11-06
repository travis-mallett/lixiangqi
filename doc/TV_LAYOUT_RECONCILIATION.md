# Homepage TV layout reconciliation — 2026-11-05

Scope: divider above the variant heading, transparent content-sized homepage TV embeds, and Three Kingdoms names along their army edges. No rules, API, artwork, engine or native navigation changes.

- LiXiangQi Mobile: not applicable. Its Standard-only native TV/game consumers do not render website iframes or Three Kingdoms; the existing variant deferral remains in force.
- Xiangqi Kids: not applicable. Its Standard-only gameplay and shared board do not consume this web TV layout; the existing variant deferral remains in force.

Both app instructions and reconciliation queues were inspected. No checkpoints were advanced and unrelated outstanding reviews remain open.

Validation: frontend type-aware lint, SCSS lint and repository formatting check passed using installed executables (the default pnpm shim attempted a sandbox-blocked reinstall). Production asset build passed. The frontend runner passed all 699 tests; invoked directly because the Windows ui/test link is not executable by Git Bash. Chromium fixture checks used the built Three Kingdoms renderer at 1440, 900 and 390 pixel viewports with 310, 240 and 340 pixel cards, verified transparent backgrounds and matching iframe/content height, and inspected screenshots. Rectangular embed fixtures also exercise resizing. Full backend tests were not run for the single HTML data attribute addition. No live server or production deployment was performed.

Deployment: normal website template and asset deployment together; no migration or deployment-tool changes.

Source: working tree over e7638e024687eb71dff5298ceec9ff6e4eefb229. The hashes below identify reviewed bytes, not approval of unrelated concurrent edits in home.scala.

| File                                                | SHA-256                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| app/views/lobby/home.scala                          | 558e7b455dc0ecdb3e65008eabed7504773a0067d9f112fb2e2aefac52b2fe9e |
| ui/bits/css/tv/_embed.scss                          | b822f9255a7ce1eba9ecb72a88127f336adac3db9079575f4b2e934ea61374c1 |
| ui/lib/src/embed.ts                                 | dbc1a75520edce01b67b950fa9dcee165df3ccb46d68af06d44e2ebefe179e3b |
| ui/lobby/css/_lobby.scss                            | 41430652cb868a3d977b7480102d7f579cd688c7d920c3209b1c60b2d9a440f9 |
| ui/site/src/site.tvEmbed.ts                         | 7e8e1fd20ce289ff4b22308648da9f008731fb3e0cf7d4ad11eb61e44cd6ea07 |
| ui/threeKingdoms/css/build/threeKingdoms.embed.scss | 4fed4162a942b2b3fb8177fbd79a4e4a5da5de8a4424bbdb5b7d7532d5d0a036 |
| ui/threeKingdoms/src/threeKingdoms.embed.ts         | e1175b0952d5ec956610e32544da64fda246e447f421874ea2ff83e085a22bea |
