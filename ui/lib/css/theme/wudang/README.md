# Seeking the Dao at Wudang theme

This directory is the standalone source package for the `wudang` UI theme.
The entrypoint is `../_theme.wudang.scss`; it imports only the partials in this
directory and the shared theme-variable contract.

The complete appearance pack registered as `wudang` composes:

- UI theme: `wudang`
- background: `seeking-the-dao-at-wudang`
- board: `xiangqi-wudang`
- pieces: `xiangqi-wudang`
- standard sound and music sets

The background lives at
`public/images/background/seeking-the-dao-at-wudang.webp`, the board at
`public/images/board/xiangqi-wudang.webp`, and the generated brush-seal
pieces at `public/piece/xiangqi-wudang/`.

## Material contract

| Material | Role |
| --- | --- |
| Inkstone | Global navigation, tool rails, clocks, engine headers, analysis controls, transient menus |
| Mounted xuan paper | Long reading, move ledgers, forms, tables, profiles, explanations |
| Jade / mineral blue | Positive state, focus, selection, links, active analytical controls |
| Cinnabar | Red-side identity, primary action, errors, current-section strokes |
| Temple gold | Donation, commemorative or rare status only |

The landscape owns expressive motion. Functional objects are opaque, still,
nearly square, and exact. No page depends on the background for its visual
coherence or legibility.

## Homepage artwork

The homepage keeps all native lobby controls, translations, live counts, and
links, then mounts them into Wudang-specific raster materials:

- `public/images/theme/wudang/inkstone-frame.webp`
- `public/images/theme/wudang/play-lobby-plaque.webp`
- `public/images/theme/wudang/play-friend-plaque.webp`
- `public/images/theme/wudang/play-computer-plaque.webp`

Their layout, interaction states, and three responsive compositions live in
`_homepage.scss`. The selectors are rooted in `html.wudang`; no other UI theme
loads these rules or assets.

## Page audit

The package contains local reconciliations for every initial-release navigation
family:

| Surface | Treatment |
| --- | --- |
| Homepage / lobby | Generated inkstone pairing tray; three textured ceremonial action plaques; live counters; paired live game and daily puzzle; paper update ledger and ink tournament ribbon |
| Live games | Inkstone clocks and control rail; mounted move sheet; stable player slips |
| Analysis and studies | Stone instrument shell, mounted-paper PV and move ledgers, jade focus, cinnabar critical states |
| Xiangqi analysis | Purpose-built engine header, paper variations, ink-stick evaluation dock, mounted tabs and analysis-request sheet |
| Puzzles | Stone tool instrument, paper feedback, shape-plus-color success/error states |
| Puzzle Themes / dashboard | Ruled paper index, restrained imagery, mineral metric system |
| Tournaments | Paper schedule and standings, stone side instruments, controlled category pigments |
| Xiangqi notation practice | Board-centered stone prompt, mounted input/configuration sheets, exact tabular timing |
| Learn | Mounted curriculum sheets, quiet stage index, Wudang board mount, short restrained completion motion |
| Profiles / settings | Formal paper ledgers and consistent recessed inputs |
| Community / forum / messages | Mounted posts and conversations within inkstone structural rails |
| Broadcast / TV / video | Paper content fields and stone navigation rails |
| Games Database / import / search | Dense paper tables, monospaced technical fields, mineral selection |
| Theme selector | Inkstone palette drawer with paper-mounted previews and a jade/ivory active keyline |

The intentionally deferred Arena discovery, Swiss, simultaneous exhibition,
Puzzle Streak, Puzzle Storm, and Puzzle Racer surfaces are not advertised and
receive no Wudang-specific maintenance in this initial package.

## Accessibility and responsive rules

- Ordinary text is dark charcoal on warm paper or warm ivory on near-black ink.
- Focus is a jade line separated by an ivory keyline on both materials.
- Correct/error states use structure and iconography in addition to color.
- Clocks, engine evaluations, ratings, and notation use tabular numerals.
- Touch controls reach 44px in narrow layouts.
- Mobile art direction preserves the temple while increasing the content veil.
- `prefers-reduced-motion` removes decorative transitions.
- `prefers-contrast: more` removes tonal texture and strengthens surfaces.
- Print output removes the landscape and stone navigation.

## Asset generation

`generate-pieces.mjs` reads the repository's established Xiangqi glyph paths
for small-size recognition and writes only to `public/piece/xiangqi-wudang/`.
It does not modify the source piece package. Run it from the repository root:

```sh
node ui/lib/css/theme/wudang/generate-pieces.mjs
```
