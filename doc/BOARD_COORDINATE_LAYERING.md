# Board coordinate layering review — 2026-11-08

Source: `d39599ca8e531bfd2297c58e49e77693c3eff96e` plus the working-tree change
to `ui/board/css/_board.scss` (SHA-256
`fb0186af9aace70f05c38693e11f9640a4cf80f910998a8d52601756b01de1b3`).

The rectangular board now composites `cg-container` instead of `cg-board`.
Coordinates and drawing layers are siblings of `cg-board`; promoting only the board
created a stacking context that trapped its pieces below the coordinates. Promoting
the common container preserves whole-board compositing and the existing layer order.
Graph boards retain their existing surface compositing.

Both native consumers were inspected in `lib/design/board/xiangqi_board.dart`:

- LiXiangQi Mobile: already covered. Its Flutter Stack places coordinate rows before
  piece sprites. The website CSS fix is not applicable to the native renderer.
- Xiangqi Kids: already covered. Its Flutter Stack likewise places coordinates before
  piece sprites. No asset, geometry, or native code changes are needed.

Neither app's checkpoint advances; unrelated pending reviews remain outstanding.
Deployment requires the normal website asset build only, with no server migration
or mobile release dependency.

Browser verification: Chromium and Firefox pass coordinate paint-order checks at
1440, 900, and 390 pixels, along with existing motion/check/shadow checks. The
Chromium compositor check passes with 12 content layers; its Firefox equivalent is
intentionally skipped because the test uses Chromium's CDP API.
