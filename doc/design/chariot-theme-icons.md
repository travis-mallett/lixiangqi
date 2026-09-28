# Chariot puzzle-theme artwork

Original artwork generated with the built-in OpenAI image-generation tool for LiXiangQi. These images are illustrative metaphors, not board diagrams. The former placeholder artwork was not used as reference.

## Visual direction

A coordinated family of hand-painted Chinese game icons: cinnabar lacquer, warm ivory, antique gold, blue-green mineral-pigment accents, and dark ink contours. The palette and edge highlights work on the site's light and dark surfaces without recoloring. The five silhouettes vary deliberately:

- **双车错**: staggered chariot wheels and an alternating ribbon of momentum.
- **大刀剜心**: a broad ring-pommel dao and a decisive rising sweep.
- **小刀剜心**: a smaller, slender knife, jade-colored grip and restrained red cord.
- **双车胁士**: two chariot wheels pressing inward around a minister's winged futou cap.
- **海底捞月**: an ivory moon cradled by a curling blue-green wave.

Chinese design context was researched through [Mu De Qian's xiangqi UI](https://www.zcool.com.cn/work/ZNTczOTIxMzY%3D.html), [Hella Mo Tang's Chinese-painting icon exploration](https://www.zcool.com.cn/work/ZMTY0Mzc5MDg%3D.html), and [Duole's official xiangqi presentation](https://game.duole.com/game/dlxiangqi). These are contextual sources, not copied artwork or claims of a single universal Chinese style.

## Delivery

The canonical website assets are the five 256 × 256 transparent WebP files in `public/images/puzzle-themes/`. They retain alpha transparency, use quality 90 encoding, and are downsampled from the generated originals. No PNG duplicate or SVG fallback is shipped. The small knife has a deliberately smaller optical footprint. `PuzzleTheme.iconFile` supplies the filename to both the themes page and the puzzle sidebar.

## Final generation prompts

The broad dao established the style. The wheel and moon motifs used it as a style reference. The small knife refined an initial generated knife. The advisor icon combines the generated cap with the established chariot-wheel design, making the two chariots explicit. References were only newly generated artwork.

### doubleChariotsMate

```text
Use case: stylized-concept. Asset type: one premium Chinese xiangqi puzzle-theme icon, a standalone raster game UI illustration designed to read crisply at 64–80 CSS pixels.
Art direction: contemporary Chinese 国风 digital game icon craft, restrained 工笔重彩 with carved lacquer and subtle mineral-pigment facets; decisive elegant ink-dark contours, broad quiet colored shapes, warm ivory edge highlights. Slight hand-painted modeling, polished but NOT photorealistic, NOT glossy plastic or generic Western fantasy loot. Shared palette: cinnabar vermilion #b74632, warm ivory #f2dfb5, antique gold #bd914b, blue-green celadon #427e7c, deep ink #283c3c. Small gold fittings only; avoid filigree clutter. Strong two-tone edge separation readable on near-white AND dark charcoal surfaces.
Canvas: square, actual transparent alpha background, isolated subject centered with all painted content inside the central 84% of width and height. No opaque backdrop, no surrounding badge, no circular disc behind the icon, no frame, no scenery. Subject should fill the square with a balanced compact silhouette. No titles, no labels, no Latin letters, no watermark. No chess-piece tokens, no board, no palace geometry, no diagrams, no text. Use imaginative visual metaphor rooted in Chinese imagery. Do not include any Western chess pieces, heraldic shields, crowns, European weapon guards, generic dragons, lanterns, pagodas, or arbitrary cultural decoration.
Input image: supporting STYLE reference only, our newly created broad-dao icon. Match its pigment texture, edge treatment, palette and hand-painted quality. Create a completely different object and silhouette as specified below; do NOT reproduce the sword.
Subject: 双车错, an imaginative emblem of coordinated chariot momentum. TWO bold ancient Chinese wooden chariot wheels, each with only six broad spokes and antique bronze hub, cinnabar lacquer spokes, warm ivory-gold rim edges with dark celadon shaded sides. Three-quarter view, staggered diagonally, one wheel lower-left foreground and the other upper-right just behind with only slight overlap, both clearly visible. A single tapered cinnabar silk-like brushstroke sweeps between them in a restrained zigzag, conveying alternating surges. Broad simple forms, kinetic asymmetry, compact icon. No complete vehicles, no axles linking wheels, no terrain, no board, no arrows, no chess pieces, no mechanical diagram.
Generate exactly ONE final standalone icon.
```

### throatCuttingMate

```text
Use case: stylized-concept. Asset type: one premium Chinese xiangqi puzzle-theme icon, a standalone raster game UI illustration designed to read crisply at 64–80 CSS pixels.
Art direction: contemporary Chinese 国风 digital game icon craft, restrained 工笔重彩 with carved lacquer and subtle mineral-pigment facets; decisive elegant ink-dark contours, broad quiet colored shapes, warm ivory edge highlights. Slight hand-painted modeling, polished but NOT photorealistic, NOT glossy plastic or generic Western fantasy loot. Shared palette: cinnabar vermilion #b74632, warm ivory #f2dfb5, antique gold #bd914b, blue-green celadon #427e7c, deep ink #283c3c. Small gold fittings only; avoid filigree clutter. Strong two-tone edge separation readable on near-white AND dark charcoal surfaces.
Canvas: square, actual transparent alpha background, isolated subject centered with all painted content inside the central 84% of width and height. No opaque backdrop, no surrounding badge, no circular disc behind the icon, no frame, no scenery. Subject should fill the square with a balanced compact silhouette. No titles, no labels, no Latin letters, no watermark. Only Chinese characters explicitly requested on authentic ROUND xiangqi pieces. Do not include any Western chess pieces, heraldic shields, crowns, European weapon guards, generic dragons, lanterns, pagodas, or arbitrary cultural decoration.
Subject: 大刀剜心. One bold traditional Chinese broad single-edged dadao blade, thick gently widening blade and angled clipped rising tip, ivory steel face with blue-green shaded bevel and ink edge, restrained brass collar with a small oval disc guard, a short cinnabar lacquer-wrapped handle and simple ring pommel. Diagonal handle lower-left to blade upper-right. A single short vermilion silk tie curves back beside the handle, integrated into the silhouette. The broad blade is the star; dynamic decisiveness, elegant sturdy silhouette, minimal details. Chinese dadao proportions, not a European sword, not a kitchen cleaver, not a Japanese katana, not a polearm. No blood, no characters, no extra objects. Generate one final icon only.
```

### smallThroatCuttingMate

```text
Use case: stylized-concept. Asset type: one premium Chinese xiangqi puzzle-theme icon, a standalone raster game UI illustration designed to read crisply at 64–80 CSS pixels.
Art direction: contemporary Chinese 国风 digital game icon craft, restrained 工笔重彩 with carved lacquer and subtle mineral-pigment facets; decisive elegant ink-dark contours, broad quiet colored shapes, warm ivory edge highlights. Slight hand-painted modeling, polished but NOT photorealistic, NOT glossy plastic or generic Western fantasy loot. Shared palette: cinnabar vermilion #b74632, warm ivory #f2dfb5, antique gold #bd914b, blue-green celadon #427e7c, deep ink #283c3c. Small gold fittings only; avoid filigree clutter. Strong two-tone edge separation readable on near-white AND dark charcoal surfaces.
Canvas: square, actual transparent alpha background, isolated subject centered with all painted content inside the central 84% of width and height. No opaque backdrop, no surrounding badge, no circular disc behind the icon, no frame, no scenery. Subject should fill the square with a balanced compact silhouette. No titles, no labels, no Latin letters, no watermark. No chess-piece tokens, no board, no palace geometry, no diagrams, no text. Use imaginative visual metaphor rooted in Chinese imagery. Do not include any Western chess pieces, heraldic shields, crowns, European weapon guards, generic dragons, lanterns, pagodas, or arbitrary cultural decoration.
Input image: EDIT TARGET, the initial 小刀剜心 icon. Keep the same hand-painted material finish and palette. Correct the silhouette to read unmistakably as a little knife, NOT a shortened broad sabre. Replace the long curved blade with a short narrow straight-backed single-edged leaf blade, only 80% of the handle's length, with a delicately angled tip. The ivory steel blade is above, the slim deep celadon jade handle below, both on a steep almost vertical diagonal toward upper-right. Use a very small plain gold collar, no wide disc guard, no ring pommel. One little vermilion cord loops elegantly from the handle end toward lower-left, shorter than the knife. Aim for refined precision, small incisive 小刀 versus the sweeping 大刀. Simple strong shape, transparent cutout, all artwork within central 76% of square canvas, no text, no scenery, no badge.
```

### doubleChariotsThreateningAdvisor

```text
Use case: precise-object-edit.
Asset type: ONE standalone premium Chinese xiangqi puzzle-theme raster icon for 双车胁士, readable at 44–64 CSS pixels.
Input image 1: EDIT TARGET, our current minister-cap icon. Input image 2: supporting visual reference for the exact chariot-wheel design and this icon family's style.
Primary change: replace the unclear hat-and-ribbons composition with TWO clearly recognizable chariot wheels pressing inward from opposite sides toward a Chinese civil official's winged futou cap. Remove the pale court tablet completely. Do not retain any pale object sticking out behind the cap.
Composition: a compact, tense three-object group, with a smaller dark celadon-black winged cap at the center and TWO distinct large cinnabar wooden chariot wheels flanking it, one upper-left and one slightly lower upper-right. The wheels lean inward toward the cap in a visual pincer; their closest rims approach its side wings. Preserve visible negative-space gaps so the hat and both wheels are separately legible. The hat crown, gold band and both flat wings remain clearly recognizable, without a face. The cap must not look mounted on the wheels or like a vehicle body: no axle or connection between the wheels. Each wheel has six broad wooden red spokes, an antique-gold hub and an ivory-gold rim edge, dark celadon outer thickness, matching image 2. At most two very short red brush-ribbon trails behind the OUTER wheel edges suggest force directed inward, never draped decoratively over the cap. The wheels must carry the idea of two threatening chariots, not be replaced by ribbons. Compact near-square silhouette, keep all three subjects large and simplify fine detail for icon readability.
Keep invariant: the existing set's contemporary Chinese 国风 painted-game-icon style, restrained 工笔重彩 influence, lacquer/mineral-pigment finish, hand-painted facets and restrained gold fittings. Match BOTH references in rendering quality and palette: cinnabar #b74632, warm ivory #f2dfb5, antique gold #bd914b, celadon #427e7c, deep ink #283c3c. Ink-dark contours with thin warm highlights for separation on white and charcoal. Not photorealistic or plastic. Make the cap and wheels feel painted by the same artist as the references.
Canvas: square, ACTUAL TRANSPARENT ALPHA background, centered subject fully visible with 8% transparent safety margin. No background badge, no scenery, no frame, no opaque backdrop, no external glow or shadow.
Avoid: court tablet, jade plaque, pale stick, helmet, shield, crown, Western heraldry, European military objects, generic dragons or lanterns, board, palace geometry, chess-piece tokens, text, arrows, instructional diagram, extra objects, watermark.
Deliver exactly ONE finished icon, not a sheet and not a UI mockup.
```

### moonScoopingMate

```text
Use case: stylized-concept. Asset type: one premium Chinese xiangqi puzzle-theme icon, a standalone raster game UI illustration designed to read crisply at 64–80 CSS pixels.
Art direction: contemporary Chinese 国风 digital game icon craft, restrained 工笔重彩 with carved lacquer and subtle mineral-pigment facets; decisive elegant ink-dark contours, broad quiet colored shapes, warm ivory edge highlights. Slight hand-painted modeling, polished but NOT photorealistic, NOT glossy plastic or generic Western fantasy loot. Shared palette: cinnabar vermilion #b74632, warm ivory #f2dfb5, antique gold #bd914b, blue-green celadon #427e7c, deep ink #283c3c. Small gold fittings only; avoid filigree clutter. Strong two-tone edge separation readable on near-white AND dark charcoal surfaces.
Canvas: square, actual transparent alpha background, isolated subject centered with all painted content inside the central 84% of width and height. No opaque backdrop, no surrounding badge, no circular disc behind the icon, no frame, no scenery. Subject should fill the square with a balanced compact silhouette. No titles, no labels, no Latin letters, no watermark. No chess-piece tokens, no board, no palace geometry, no diagrams, no text. Use imaginative visual metaphor rooted in Chinese imagery. Do not include any Western chess pieces, heraldic shields, crowns, European weapon guards, generic dragons, lanterns, pagodas, or arbitrary cultural decoration.
Input image: supporting STYLE reference only, our newly created broad-dao icon. Match its pigment texture, edge treatment, palette and hand-painted quality. Create a completely different object and silhouette as specified below; do NOT reproduce the sword.
Subject: 海底捞月. A large warm ivory-gold crescent moon being cradled and lifted by ONE curling blue-green Chinese decorative water wave, the wave flowing from lower-left around the moon's lower edge into an upward scoop on the right. Moon upper-left, wave lower-right. Restrained Chinese painting rhythm and 留白, elegant irregular flowing silhouette. Two broad celadon layers, ink-dark undersides, warm ivory foam edges, tiny cinnabar accent as one curved reflection in the water. Wave must read as water, not cloud, no Hokusai-style enormous breaking surf. The luminous crescent and scoop of water form a compact graceful open circle but there is no enclosing badge. No stars, no clouds, no landscape, no characters, no fishing implements, no chess pieces.
Generate exactly ONE final standalone icon.
```
