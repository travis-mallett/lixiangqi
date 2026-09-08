# Board animations

Read [`WORKFLOW.md`](WORKFLOW.md) before creating, processing, replacing, or
integrating an animation. It is the canonical production and quality-assurance
guide for these assets.

Board effects are grouped by theme and event:

```text
<theme>/<event>/animation.webp
<theme>/<event>/master/frame_###.png
```

`animation.webp` is the web-delivery asset. The numbered, straight-alpha RGBA PNG sequence is the lossless production master used to create future delivery formats without compounding compression artifacts.

Delivery encoding may use high-quality WebP color compression when the moving artwork is unusually complex, but its alpha channel must remain exact. The PNG sequence is always authoritative.

The `lixiangqi-default` capture and check animations are 720 × 720 pixels, contain 25 frames, run for 868 ms, and play once. The checkmate animation uses the same canvas at 24 fps, contains 36 frames, and runs for 1,500 ms. Every animation has fully transparent first and final frames so that it enters and leaves the board cleanly.
