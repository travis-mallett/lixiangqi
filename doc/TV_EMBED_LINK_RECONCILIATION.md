# Homepage TV embed links — November 12, 2026

The homepage's variant TV iframe renders the selected game as a link to its TV
channel. The initial frame HTML and later live-game replacements now both set that
link to open in a new tab. The shared mini-game renderer owns the link target.

## Mobile reconciliation

- **LiXiangQi Mobile: not applicable.** The native TV feature consumes the game
  stream API and does not render the homepage iframe or its embedded HTML links.
- **Xiangqi Kids: not applicable.** Its native gameplay and TV consumers do not
  render website homepage TV embeds.

Both app instructions and their website reconciliation documentation were reviewed.
`node scripts/mobile-reconciliation.mjs` was run before and after the change. It
reports existing outstanding reviews in both apps; no app files or receipts were
changed, and no checkpoint was advanced past those reviews.

## Verification and release

`git diff --check` passed for the three changed Scala files. No tests were added or
run. `lila/compile` could not complete: the shared SBT lock was inaccessible, and
the repository-local retry could not resolve uncached build plugins while network
access was unavailable.

Deploy the website backend normally to publish the updated renderer. There is no
data migration or mobile release dependency.

Source commit: `78ea77b4e186c966533dd3d306dcbd3574889125`.

| Source file                             | SHA-256                                                             |
| --------------------------------------- | ------------------------------------------------------------------- |
| `app/Env.scala`                         | `0bacef9bb04118100f4a47582252b845aecdda881a5e86b84071df23b15b84cd`  |
| `app/views/tv.scala`                    | `7731be96991b0bb0a216dbdaa29fe90c184693637cd6bae3454ffe90e83b7faa9` |
| `modules/game/src/main/ui/GameUi.scala` | `21e8b5cba917c6c08c8153f1595915f4fb290e70232fffbc9e00c7b34aac4b9e`  |
