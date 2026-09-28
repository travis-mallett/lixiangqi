# Cyan accent — review candidate

Capture is a color-only copy of `lixiangqi-default/capture`, inspired by the
board's `#3EA1C3` move-indicator accent. The character and slash use cyan-blue
midtones, pale highlights, and deep blue shadows; the ink stays near charcoal.
This theme is not registered for application playback yet.

The 25 PNG masters retain the source's 720 × 720 canvas and pixel-identical alpha.
The lossless animated WebP retains all source frame delays (868 ms total), plays
once, and has transparent first and final frames.

Every master uses the same RGB transform (channels in their original 0–255 range):

```text
R' = 0.045 R + 0.955 B
G' = 0.684 R + 0.316 B
B' = 0.903 R + 0.097 B
A' = A
```

This maps warm gold into a shaded cyan palette while preserving neutral grays.
The production frames are recolored originals, not regenerated artwork. The
transform is specific to this source palette and should not be applied blindly
to differently colored themes.
