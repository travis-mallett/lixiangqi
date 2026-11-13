# Solid lifted piece sidewalls

The shared motion renderer owns raised piece depth for all seven piece sets,
including variant faces and concealed backs. Existing face SVGs remain the source
of material colors; the sidewall is generated once per image and orientation.

## Geometry and opacity

The sidewall is a filled 90-unit circle inside a padded 100-unit image, with no
CSS border, inset shadow or clipped ellipse. Face and sidewall form one flattened
painting plane, then receive the existing perspective and pitch together. Jieqi
turnovers retain their separate 3D front/back stack.

Thickness is `7.65 * sin(pitch) / sin(27°)` percent of the piece canvas. It contracts
to zero as the piece lands instead of fading through the board. Sidewalls stay
fully opaque throughout lift, hold, carry and landing. Normal contour antialiasing
and the existing whole-piece capture/reveal effects are separate from material
opacity. The lower bevel shades an already opaque body; it does not make it
transparent. The rim shares the face's brightness filter.

## Wood and material continuity

Default Wood and Western Chess Symbols already contain a rounded bevel and
directional lighting. A uniform average color creates a visible join with that
bevel. The renderer now traces 33 positions along the front circumference and
continues those colors vertically into the new sidewall. Inscription colors are
outside the sampled region. Wood keeps its original face, bevel and grain;
its sidewall follows the same lighting instead of adding another outline.

Sampling searches inward from radius 45.2% to 42% for opaque material, allowing
for Wudang's irregular outline. A five-tap spatial filter removes raster-contour
noise before it can stretch into stripes, while retaining broad material lighting
and the two side endpoints. A subtle bottom bevel darkens only the last 12% of
the circle. No new piece meshes, separate face assets or per-frame canvas work
are introduced.

## Cost and native implementations

The website reads a 256 px raster once per image/rotation and caches one small
SVG background. The existing rim element remains the only sidewall element.
Per-frame work remains transform animation; the old border, blurred inset shadows
and opacity tracks are removed. Material analysis is not repeated during moves.

Both Flutter apps read their existing 384 px raster directly and cache the same
33 colors. Two filled ovals replace the old blurred rim/outline and opacity
wrapper. Native thickness is derived from pitch, removing the redundant `rim`
animation state. Neither app enables variant gameplay as part of this change.

## Verification

- The material unit tests exercise every released face/back at web and native
  raster sizes and check opaque interior pixels and the rounded lower silhouette.
- Chromium and Firefox compare black/white backdrop screenshots to measure actual
  rendered coverage at 42 px and 98 px during selection and paused landing.
  This detects translucency independently of the material's apparent color.
- Existing browser tests cover carry, graph layouts, cleanup and compositor cost.
- Flutter pixel tests capture all seven standard themes during hold and landing
  at the same two sizes. Both apps also run their complete analysis/test checks
  and Android builds. iOS requires macOS/Xcode and is not verified on Windows.

Deployment uses the normal website asset build and native application releases.
There is no server migration or persistent preference change.

November 11, 2026 local verification: frontend formatting, type-aware/SCSS lint,
production assets and all 743 frontend tests pass. Browser checks cover 29 cases
across Chromium/Firefox; the Firefox compositor inspection is intentionally
skipped because it requires Chromium's CDP. The resting multi-board measurement
is 12 content layers, within the existing limit of 40. Main mobile passes 498
tests (two existing skips), Kids 228 (one existing skip); both pass fatal-info
analysis and build Android debug APKs for arm64/x64. Both snapshot checks verify
130 standard assets and the catalog. Full backend/Linux CI, CodeQL, WebKit, iOS,
physical devices and live deployment were not run for this rendering follow-up.
