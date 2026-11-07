# Profile links in rich text

Blog authors can link an account by writing `[Lunps28](/@/Lunps28)` or using the
editor's link control with the bare username as its label. The existing Markdown
mention syntax also produces a profile link. Decorations must not be copied into
the article. Titles, introductions and image alternative text remain plain text.

`bits.expandText` enhances plain same-origin profile links in rendered rich text.
`profileLinks.ts` deduplicates account IDs and loads current public identities from
`POST /api/users`, in batches within the endpoint's 300-user limit. The existing
`userLink` component renders the username, title, flair, patron wings and Xiangqi
rank, with optional flags now supported by that component. There is no second
identity template or baked-in profile metadata in cached Markdown.

Custom link labels, external links, images, code examples and profile subpages
remain unchanged. Missing accounts and failed lookups leave the original direct
profile links usable. Shared Markdown styling distinguishes inline identity
images from article illustrations and keeps ordinary identities together when
wrapping prose.

## November 6, 2026 verification and release

The published tournament article `m1L9BrtK` was backed up, then its nine body and
caption mentions were changed to direct profile links. Its official publication
and live homepage carousel entry were retained. Recovery sources are in the
ignored `blog/first-tournament/before-profile-links/` directory. The editor was
checked against the blog writing guide; wording, paragraph structure, headings,
cover and body diagram were preserved. A published link was followed to the
player's profile.

The website renderer requires normal asset deployment. No server deployment,
database migration, dependency change or backend rebuild was performed. The
existing `../lixiangqi-beta-deployment/push-local-live.ps1` prepares a full release;
the working tree also contains unrelated concurrent changes. Deployment tooling
does not need modification for this feature.

Validation:

- Production asset build passed using the build entry point
  `node --no-warnings src/main.ts --no-install -p` from `ui/.build`. The Git Bash
  wrapper cannot start inside this Windows sandbox; dependencies were already
  installed. Node 24 was used.
- All 718 frontend tests passed with `node ui/.test/runner.mjs`, including URL
  validation, batched repeated mentions, complete identity rendering, missing
  accounts, code-link exclusion and HTTP failure handling.
- `oxlint --type-aware`, repository-wide `oxfmt --check`, and the full Stylelint
  check passed. An earlier unrelated editor-style failure was resolved by the
  concurrent work before the final check. Equivalent installed
  binaries were used because pnpm's automatic install attempted a sandbox-denied
  project-store symlink.
- The built renderer was checked in a local browser fixture using the published
  article and real public profile responses at desktop, 800px and 390px widths.
  All nine mentions rendered, flags/flair loaded inline, and there was no
  horizontal page overflow. This is local build verification, not a live asset
  deployment.

## Mobile reconciliation

Source HEAD: `f3d8e9cca137c47844b3bc16cb1f329a2ea557bd`. This is a narrow review;
neither application's checkpoint nor unrelated review queues were advanced.
The reconciliation scanner ran before work and again before handoff.

LiXiangQi Mobile: **already covered**, with the editorial links inherited from the
server. `NativeMarkup` recognizes direct profile links and uses `PlayerName`,
which resolves current metadata through `PlayerDirectoryScope` and opens the
native profile. The existing parser reads flag/country, flair, patron color and
Xiangqi rank. The pinned Flutter SDK passed 25 blog and player-directory tests,
including the actual revised article rendered at 390px with nine `PlayerName`
widgets. No native code or release is needed. No Android/iOS build was run for
this website-only change.

Xiangqi Kids: **not applicable**. The garden has no blog reader or rich-text
community surface; this does not change its gameplay, puzzles, accounts or board
assets. No native change or release is needed.

Reviewed working-tree SHA-256 values:

| File                                   | SHA-256                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `ui/bits/src/bits.expandText.ts`       | `aa99b1963941acf076960edccefd03e47c0e49d1ccd2668022c6d2abfcdfd30f` |
| `ui/lib/src/view/profileLinks.ts`      | `74c187c525c68c219d35f656183da127b46f6ba022fc528ecff5676832e17bda` |
| `ui/lib/src/view/userLink.ts`          | `fe539c863c3dbc0e8483d463e1fb1a631352bbbebda8327aff3c1eb3826f11e7` |
| `ui/lib/tests/profileLinks.test.ts`    | `9269a933afbc1ce396c631c2e004d10b0476d9985ade79fea3b1491f694c0d54` |
| `ui/lib/css/component/_markdown.scss`  | `6ad52bd9e0617f2bbd4f8d9c90b35cdc1ea586cc60826ae260be3f69d39bf680` |
| `ui/lib/css/component/_user-link.scss` | `2a000000f1cb3cced61b52949f0e29869ca0e029fa027d97061ffc1eb94db1cf` |
