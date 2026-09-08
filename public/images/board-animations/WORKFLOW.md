# Lixiangqi board-animation workflow

This is the canonical production workflow for creating and integrating board
event animations. It records the practical lessons learned while producing the
default capture, check, and checkmate effects.

## Canonical event text

Use these exact characters. Do not guess, translate, substitute a variant, or
allow a video generator to redraw them.

| Event | Required text | Notes |
| --- | --- | --- |
| Capture | `吃` | One character. |
| Check | `將` | One Traditional Chinese character. Do not use `將軍`. |
| Checkmate | `绝杀` | Two Simplified Chinese characters used by this theme. |

Typography is part of the artwork. Verify the text at full resolution in every
retained frame; reject frames in which a stroke morphs, disappears, or becomes
another character.

## Production overview

1. The user supplies visual references and identifies the intended event.
2. Analyze the reference videos frame by frame and define the design, motion,
   cadence, and target duration.
3. Prepare a high-quality image-to-video keyframe on a pure green background and
   write a concise Google Veo prompt.
4. The user generates a video with Gemini/Veo and returns the original result.
5. Select the usable action, remove bad or idle footage, key and despill every
   retained frame, repair defects, and construct reliable fades manually.
6. Export a lossless straight-alpha PNG master and a timed animated WebP.
7. Inspect every frame over contrasting backgrounds and test the animation in
   the board at representative sizes.
8. Integrate the event through the shared board-event path and verify live play,
   forward replay, analysis, TV, and puzzles.

The generated MP4 is intermediate source material, not a shipping asset.

## 1. Analyze the references

Inspect references rather than estimating their timing by eye:

- Record resolution, frame rate, duration, codec, and audio streams with
  `ffprobe`.
- Extract frames at their native cadence with `ffmpeg`.
- Make a numbered contact sheet that includes timestamps, then inspect important
  frames individually at high zoom.
- Identify the first visible frame, primary slash or impact, overshoot, settle,
  clean stable design, hold, and disappearance.
- Distinguish motion of the whole emblem from independent motion of the text,
  ink, slash, particles, glow, and camera.
- Note generator defects separately from intentional effects.

Choose timing from the visual action, not from the length of the supplied file.
A long generated hold or a second animation cycle must be removed.

Current `lixiangqi-default` references are useful baselines, not mandatory
templates:

| Event | Canvas | Frames | Duration |
| --- | ---: | ---: | ---: |
| Capture | 720 x 720 | 25 | 868 ms |
| Check | 720 x 720 | 25 | 868 ms |
| Checkmate | 720 x 720 | 36 | 1500 ms |

## 2. Prepare the Veo keyframe

Google Veo normally delivers an MP4, not a production-ready alpha video. Make
the supplied keyframe a chroma source:

- Use a flat, uniform `#00FF00` background across the entire canvas.
- Do not add a green gradient, vignette, floor, lighting spill, or green shadow.
- Keep generous clear green space around all intended artwork.
- Avoid intentional green in the design. The default theme uses warm gold or
  ivory calligraphy, black sumi-ink brushwork and splatters, and a crimson slash.
- Keep the emblem centered and include no Xiangqi board, pieces, interface,
  labels, watermark, border, or unrelated scenery.
- Preserve the exact characters and brush construction used by the theme.
- Prefer a 16:9 generator input while keeping the emblem safely centered. The
  final frames can be cropped to a square after generation.

Treat an image-to-video reference as Veo's initial frame. Do not write a prompt
that simultaneously tells Veo to begin empty and later reveal the supplied
image; that contradicts how image-to-video conditioning usually behaves.

## 3. Prompt Veo for editable source footage

Short, visually coherent prompts tend to outperform frame-by-frame direction.
Ask for one action and leave final timing to post-production. A useful prompt
structure is:

> Animate the supplied Xiangqi event emblem as one premium, decisive ink-brush
> impact. Preserve the exact Chinese characters, calligraphy, colors, centered
> composition, and pure flat green background. Use a locked camera. Add one
> fast diagonal slash, a restrained burst of ink and warm light, a brief
> physical settle, then hold the complete clean emblem still. No fade-out; no
> second reveal or repeated action. No zoom, camera movement, extra slash,
> crossed lines, extra text, character mutation, 3D extrusion, scenery,
> watermark, border, green haze, or audio-dependent action.

Adapt the motion and artistic nouns to the reference, but retain these rules:

- Preserve the supplied typography and composition exactly.
- Request a single coherent impact-and-settle action.
- Lock the camera and background.
- Ask for one slash only when the design calls for one.
- Ask for a clean final hold, not a generated fade-out.
- Avoid detailed per-frame timing. Use the shortest practical generation and
  trim or retime it later.
- Do not rely on generated audio. Shipping visual assets are silent.

Common failures include a second reveal, crossed slashes, sparkle additions,
macro zooms, typography mutation, a green-tinted fade, and several seconds of
idle footage. The prompt reduces these risks but post-production must still
assume they can occur.

## 4. Select and retime the usable action

Work from extracted source frames and preserve source cadence when it looks
good. Prefer deterministic frame selection or duplication to optical-flow
interpolation, which can deform brush strokes and Chinese characters.

1. Find the usable start of the action and the last clean, stable final design.
2. Exclude malformed frames, restarts, unintended additions, and the long hold.
3. Build a short entrance by changing alpha over the first retained frames when
   the source has no usable appearance transition. The emblem should be fully
   visible by the primary impact.
4. Hold the last clean frame only as long as the effect needs to read.
5. Build the fade from duplicates of that clean frame by changing alpha only.
   Never depend on Veo's generated fade.
6. Add completely transparent first and final frames to make replacement and
   compositing predictable.

Bake the final cadence into `animation.webp`. Do not compensate with CSS,
JavaScript playback-rate tricks, or event-specific timers that disagree with
the file.

## 5. Create clean transparency

MP4 chroma is commonly H.264 4:2:0, so the green is spatially averaged and is
not one exact RGB value. A single-color key is insufficient.

Use a controlled keying pipeline:

- Estimate the screen color per frame from known background regions.
- Derive alpha primarily from green dominance, such as
  `G - max(R, B)`, using a soft transition rather than a hard cutoff.
- Reconstruct edge color by unmixing the estimated screen color from the pixel
  according to alpha. Simply deleting green pixels leaves dark or green halos.
- Remove tiny disconnected matte noise without erasing intentional ink
  splatter, glow, or motion blur.
- Apply restrained despill. For the default warm-gold, crimson, black, and
  neutral palette, residual green and blue excess can be clamped only where the
  intended palette justifies it. Do not use this rule blindly for a future theme
  containing green artwork.
- Explicitly mask generator additions such as unwanted sparkles when automatic
  keying cannot distinguish them from the design.
- Use premultiplied-alpha resizing and filtering, then unpremultiply for the
  straight-alpha PNG output.
- Set RGB to zero wherever alpha is zero. This prevents invisible green from
  leaking during later scaling or encoding.
- Use one fixed crop and transform for the sequence. Never normalize each frame
  to its own nontransparent bounding box; that creates visible jitter.

If peripheral particles touch a generated frame edge, use only a small, safe
edge feather on those particles. Do not alter the primary emblem to hide a bad
crop.

### Manual fade rule

The final held and fading frames should be pixel-identical in RGB to the chosen
clean final frame. Only alpha changes. This eliminates the green cast and design
morphing frequently introduced by generated fades. If the final design should
omit a transient slash, make one carefully retouched clean hold frame first,
then derive every fade frame from it.

## 6. Inspect every frame

Frame-by-frame inspection is required; checking only the WebP playback is not
enough.

Composite every master frame over:

- white;
- near-black;
- saturated magenta or another color that exposes green fringing; and
- a representative Lixiangqi board screenshot when available.

At full resolution and high zoom, verify:

- no green hue, green fringe, hidden green RGB, or chroma blocks remain;
- the exact Chinese text stays legible and stable;
- brush edges, ink texture, splatter, glow, and motion blur remain intentional;
- there are no accidental sparkles, duplicate strokes, extra slashes, or jumps;
- the crop and center do not jitter;
- the first and final frames are completely transparent;
- image borders have zero alpha unless intentional artwork truly reaches them;
- the fade uses the clean hold's RGB and changes alpha monotonically;
- the effect reads clearly without obscuring too much of the board.

Inspect alpha bounds and channel statistics programmatically as well as
visually. Automated checks help find outliers; they do not replace visual QA.

## 7. Package the assets

Use this structure:

```text
public/images/board-animations/
  <theme>/
    <event>/
      animation.webp
      master/
        frame_000.png
        frame_001.png
        ...
```

Repository deliverables are:

- a lossless, straight-alpha PNG sequence as the authoritative master; and
- an animated WebP for application delivery.

Do not commit the generated MP4, temporary contact sheets, ProRes intermediates,
or Apple/Android-specific exports unless the task explicitly asks for them.
Animated WebP color may use a high-quality setting when lossless color is
unreasonably large, but alpha must remain exact and the result must be compared
against the PNG master. The animation must play once and contain no audio.

Keep the artwork's occupied area consistent with the other events in its theme.
The application sizes a square canvas relative to the board, so excessive empty
space or oversized art inside that canvas changes its perceived size even when
CSS is unchanged.

## 8. Integrate through the shared event path

The default integration lives in:

- `ui/lib/src/xiangqiBoardAnimation.ts` for event assets, durations, preloading,
  and animation dispatch; and
- `ui/site/src/sound.ts` for the shared move-event boundary and sound behavior.

Follow these application rules:

- Add the new event to the central asset and duration mapping.
- Use board-relative sizing and the shared overlay; do not place it with page-
  specific pixel coordinates.
- Preload the asset so sound and animation can begin together without a first-
  use download delay.
- Trigger on live moves and forward history transitions, including move-list
  selection, analysis controls, TV controls, and puzzles.
- Do not trigger while navigating backward through history.
- Enforce one result with this precedence:
  `checkmate > check > capture`. A checking capture plays only check; a mating
  capture plays only checkmate.
- Restart or replace the existing overlay cleanly instead of stacking effects.
- Respect reduced-motion preferences.
- Keep animation visibility independent of whether sound is enabled.
- Keep the event's speed in its WebP and its duration in the central metadata;
  do not add page-specific speed code.

For a dedicated synchronized sound, preload it and launch it in the same event
callback as the animation. A secondary spoken cue may start alongside it without
sample-level synchronization. Keep all audio out of the WebP itself and avoid
mixing multiple event classes after precedence has selected one.

## 9. Validate before handoff

At minimum:

- verify WebP dimensions, frame count, per-frame delays, total duration, loop
  count, alpha, and absence of audio;
- compare representative WebP frames against the PNG master;
- run formatting, type checking, and focused tests for touched integration code;
- test live capture/check/checkmate behavior;
- test forward and backward navigation in analysis and TV;
- test move-list jumps and puzzle opponent responses;
- verify checkmate/check/capture precedence and absence of overlapping sounds;
- verify reduced-motion and sound-disabled behavior;
- inspect the rendered size on small and large responsive boards.

Make surgical integration changes and preserve unrelated worktree changes. When
a new production lesson is confirmed, add it here so the next animation starts
from the improved process rather than rediscovering it.
