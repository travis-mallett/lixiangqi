# Horse puzzle-theme artwork

Original artwork generated with the built-in OpenAI image-generation tool for LiXiangQi. The eight horse-category placeholders were not opened or used as design references.

## Visual direction

A family of painted mineral-blue and ivory icons with deep indigo accents, dark ink contours and small muted bronze fittings. The contour weight, softly modeled volumes and edge highlights relate to the chariot set; the dominant indigo replaces its cinnabar accent. Each icon has a different silhouette or action. These are illustrative readings of the Chinese method names, not board diagrams or claims of established historical emblems.

Palette:

- Indigo: `#365b94`
- Mineral blue: `#82a6cd`
- Warm ivory: `#ede5d2`
- Blue-black ink: `#252e43`
- Muted bronze: `#a68a58`

| Method   | Visual interpretation                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------- |
| 单马擒王 | A single leaping steed descending onto a captured commander's standard.                                   |
| 卧槽马   | A low, alert reclining horse beside a small feeding trough; contained power.                              |
| 挂角马   | A carved horse pendant hanging obliquely from an indigo silk cord.                                        |
| 钓鱼马   | A bamboo rod and fish close to a low curl of water.                                                       |
| 高钓马   | A steeper rod lifts the fish high above detached water drops.                                             |
| 八角马   | An angular pleated fan bearing a running horse; spreading folds give the icon its distinctive silhouette. |
| 拔簧马   | A Chinese crossbow releasing a bolt, interpreting stored tension and its sudden release.                  |
| 双马饮泉 | Two separate horses lower their muzzles toward the same spring.                                           |

The fan and crossbow are original visual analogies, not literal explanations of the moves. No boards, palace layouts, arrows, piece tokens, Western chess knights, heraldic shields or crowns are used. The horses are complete animals or painted/carved animal motifs rather than chess-piece silhouettes.

## Chinese reference context

- [Palace Museum: recumbent jade horse](https://www.dpm.org.cn/collection/jade/232264.html) informed the compact, curved horse form.
- [Palace Museum: horse-themed collection exhibition](https://www.dpm.org.cn/topic/2026horseyear.html) supplied context for varied equine poses and artistic media.
- [Znny: Chinese game item icons](https://www.zcool.com.cn/work/ZNTY4OTI3NDA%3D.html) and [瘦高: Chinese-style icons](https://www.zcool.com.cn/work/ZNDUxMzM4NTI%3D.html) supplied contemporary icon-design context.
- [Palace Museum: folding-fan painting exhibition](https://www.dpm.org.cn/show/226187.html) supplied context for painting within a compact fan format.
- [Xiangqi Museum: 拔簧马](https://www.xqmuseum.cn/articledetail/211.html) discusses the name's association with stored energy.
- [National Museum of China: bronze crossbow mechanism](https://www.chnmuseum.cn/zp/zpml/csp/202008/t20200826_247436.shtml) supports using a Chinese crossbow as the release-of-tension metaphor.

These are contextual references, not copied designs or a claim that Chinese designers use one universal style. No external artwork was supplied to the generator. The new double-horses icon used the existing original chariot-wheels artwork as a rendering-style reference, with an explicitly different palette. The other seven used the new double-horses icon as their style and palette reference.

## Delivery

Canonical assets: eight 256 × 256 transparent WebP files in `public/images/puzzle-themes/`, quality 90. Generated alpha and painted colors are preserved; the artwork is cropped to its visible bounds, proportionally downsampled and centered inside a 236 × 236 area. Near-invisible alpha noise is ignored when calculating bounds. The existing CSS mounts and theme variables supply the circular background. No separate light/dark files, PNG duplicates or SVG fallback are shipped.

`PuzzleTheme.iconFile` supplies the canonical filenames to the themes page and the puzzle sidebar. Horse Cannon Checkmate (马后炮) belongs to the cannon category and is outside this set.

## Final generation prompts

### singleHorseCapturesKing

```text
Use case: stylized-concept. Asset type: ONE premium Chinese xiangqi game UI icon, hand-painted raster illustration, readable at 56–80 CSS pixels.
Art direction: contemporary Chinese 国风 game icon craft, restrained 工笔重彩, softly carved shapes and subtle mineral-pigment modeling, decisive ink-dark contour and pale warm edge highlights. Compact expressive silhouette, elegant controlled brush rhythm and negative space. Consistent with the supplied chariot icon in quality, texture, contour weight and level of modeling, but establish a DISTINCT HORSE CATEGORY PALETTE: rich indigo #365b94, mineral blue #82a6cd, pale warm ivory #ede5d2, deep blue-black ink #252e43, very small muted champagne-bronze accents #a68a58. Indigo/blue is the dominant accent. No red, vermilion, orange, turquoise or green accents. Not photorealistic, not plastic, not generic Western fantasy loot.
Canvas: square, actual transparent alpha background. Isolated standalone artwork; all content inside central 84% with clear margin. No background disc, frame, badge, rectangle, scenery, ground shadow, glow, labels, writing or watermark. No board, palace geometry, move arrows, chess pieces, horse-head chess knights or chess pedestals. No Western shields, crowns, European armor, heraldry, dragons, pagodas, lanterns or arbitrary cultural decoration. Chinese horse forms should have a strong rounded neck and torso, lively swept mane and compact natural proportions, not a unicorn or a chess knight.
Generate exactly one finished icon.
Input image: supporting STYLE AND PALETTE reference only, the newly generated double-horses icon. Match its painted indigo/ivory finish. Create only the completely different composition below; do not import the paired horses or water unless specifically requested.
Subject: 单马擒王, one indigo-and-ivory Chinese steed seizing a commander's standard. ONE full-bodied horse in a dynamic collected forward leap facing right, pale mineral-blue torso, ivory face and lower legs, strong compact rounded chest, deep indigo mane and raised flowing tail. All FOUR legs anatomically coherent and distinguishable, forelegs descending together, hindlegs tucked. Beneath one forehoof is a small fallen Chinese military pennant of folded indigo silk with narrow bronze-gold hem on a short diagonal wooden staff; this one simple pennant signals captured command. The pennant has no text or symbols and no European fleur-de-lis or heraldry; it occupies at most a quarter of the composition. Energetic diagonally rising silhouette, horse is clearly the protagonist, no rider, no weapons, no background. Natural equine proportions, with the rounded powerful volume and economical contour found in Chinese painted steeds, not a fantasy pony. Exactly one horse and one small fallen standard.
```

### elbowHorse

```text
Use case: stylized-concept. Asset type: ONE premium Chinese xiangqi game UI icon, hand-painted raster illustration, readable at 56–80 CSS pixels.
Art direction: contemporary Chinese 国风 game icon craft, restrained 工笔重彩, softly carved shapes and subtle mineral-pigment modeling, decisive ink-dark contour and pale warm edge highlights. Compact expressive silhouette, elegant controlled brush rhythm and negative space. Consistent with the supplied chariot icon in quality, texture, contour weight and level of modeling, but establish a DISTINCT HORSE CATEGORY PALETTE: rich indigo #365b94, mineral blue #82a6cd, pale warm ivory #ede5d2, deep blue-black ink #252e43, very small muted champagne-bronze accents #a68a58. Indigo/blue is the dominant accent. No red, vermilion, orange, turquoise or green accents. Not photorealistic, not plastic, not generic Western fantasy loot.
Canvas: square, actual transparent alpha background. Isolated standalone artwork; all content inside central 84% with clear margin. No background disc, frame, badge, rectangle, scenery, ground shadow, glow, labels, writing or watermark. No board, palace geometry, move arrows, chess pieces, horse-head chess knights or chess pedestals. No Western shields, crowns, European armor, heraldry, dragons, pagodas, lanterns or arbitrary cultural decoration. Chinese horse forms should have a strong rounded neck and torso, lively swept mane and compact natural proportions, not a unicorn or a chess knight.
Generate exactly one finished icon.
Input image: supporting STYLE AND PALETTE reference only, the newly generated double-horses icon. Match its painted indigo/ivory finish. Create only the completely different composition below; do not import the paired horses or water unless specifically requested.
Subject: 卧槽马, a poised reclining steed with contained power. ONE entire Chinese horse resting low with folded legs, its long rounded neck turning back attentively over its shoulder, ears pricked. Use the compact curled sculptural rhythm of Chinese carved recumbent jade horses, translated into painted mineral-blue and ivory rather than photoreal sculpture. Indigo mane and tail, ivory-blue body, tiny bronze bridle fitting. A small dark indigo-lacquer wooden feeding trough is nestled just in front of its bent forelegs at lower-right, no other stable furniture. Horse about 80% of the silhouette, trough only 20%; recognizably low and coiled, not asleep or weak. All anatomy resolves into three or four broad shapes readable at 56px. No horseshoe, no grass, no cloud, no plinth. Distinct squat horizontal silhouette.
```

### palcornerHorse

```text
Use case: stylized-concept. Asset type: ONE premium Chinese xiangqi game UI icon, hand-painted raster illustration, readable at 56–80 CSS pixels.
Art direction: contemporary Chinese 国风 game icon craft, restrained 工笔重彩, softly carved shapes and subtle mineral-pigment modeling, decisive ink-dark contour and pale warm edge highlights. Compact expressive silhouette, elegant controlled brush rhythm and negative space. Consistent with the supplied chariot icon in quality, texture, contour weight and level of modeling, but establish a DISTINCT HORSE CATEGORY PALETTE: rich indigo #365b94, mineral blue #82a6cd, pale warm ivory #ede5d2, deep blue-black ink #252e43, very small muted champagne-bronze accents #a68a58. Indigo/blue is the dominant accent. No red, vermilion, orange, turquoise or green accents. Not photorealistic, not plastic, not generic Western fantasy loot.
Canvas: square, actual transparent alpha background. Isolated standalone artwork; all content inside central 84% with clear margin. No background disc, frame, badge, rectangle, scenery, ground shadow, glow, labels, writing or watermark. No board, palace geometry, move arrows, chess pieces, horse-head chess knights or chess pedestals. No Western shields, crowns, European armor, heraldry, dragons, pagodas, lanterns or arbitrary cultural decoration. Chinese horse forms should have a strong rounded neck and torso, lively swept mane and compact natural proportions, not a unicorn or a chess knight.
Generate exactly one finished icon.
Input image: supporting STYLE AND PALETTE reference only, the newly generated double-horses icon. Match its painted indigo/ivory finish. Create only the completely different composition below; do not import the paired horses or water unless specifically requested.
Subject: 挂角马, an imaginative 'hanging horse' pendant. A small finely carved pale ivory-blue jade FULL-BODY recumbent horse pendant suspended diagonally from ONE taut deep-indigo silk cord; the cord makes a simple tied loop at upper-left, meets a small bronze suspension fitting at the horse's withers, and a single short indigo tassel falls at lower-right. The rounded jade horse has a raised alert neck, clearly folded legs and a curved flowing indigo-inlaid tail, recognizable as a complete horse not a horse-head chess token. The horse pendant hangs with its nose angled toward upper-right and weight visibly below the cord; a compact ascending diagonal silhouette. Hand-painted mineral pigment finish with subtle jade volume, restrained incision details. No external frame, no ornamental disc, no board corner, no roof or palace, no beads or extra charms.
```

### anglerHorse

```text
Use case: stylized-concept. Asset type: ONE premium Chinese xiangqi game UI icon, hand-painted raster illustration, readable at 56–80 CSS pixels.
Art direction: contemporary Chinese 国风 game icon craft, restrained 工笔重彩, softly carved shapes and subtle mineral-pigment modeling, decisive ink-dark contour and pale warm edge highlights. Compact expressive silhouette, elegant controlled brush rhythm and negative space. Consistent with the supplied chariot icon in quality, texture, contour weight and level of modeling, but establish a DISTINCT HORSE CATEGORY PALETTE: rich indigo #365b94, mineral blue #82a6cd, pale warm ivory #ede5d2, deep blue-black ink #252e43, very small muted champagne-bronze accents #a68a58. Indigo/blue is the dominant accent. No red, vermilion, orange, turquoise or green accents. Not photorealistic, not plastic, not generic Western fantasy loot.
Canvas: square, actual transparent alpha background. Isolated standalone artwork; all content inside central 84% with clear margin. No background disc, frame, badge, rectangle, scenery, ground shadow, glow, labels, writing or watermark. No board, palace geometry, move arrows, chess pieces, horse-head chess knights or chess pedestals. No Western shields, crowns, European armor, heraldry, dragons, pagodas, lanterns or arbitrary cultural decoration. Chinese horse forms should have a strong rounded neck and torso, lively swept mane and compact natural proportions, not a unicorn or a chess knight.
Generate exactly one finished icon.
Input image: supporting STYLE AND PALETTE reference only, the newly generated double-horses icon. Match its painted indigo/ivory finish. Create only the completely different composition below; do not import the paired horses or water unless specifically requested.
Subject: 钓鱼马, an elegant Chinese angling metaphor. ONE curved slender bamboo fishing rod sweeps diagonally from lower-left to upper-right. The rod has an indigo silk-wrapped grip and a tiny bronze binding, warm ivory-bamboo highlights, deep blue shadows. A single visible indigo line bows inward to one small silver-blue carp that turns in a C shape just ABOVE a single broad low curling indigo water ripple at lower-right; the carp's upward mouth approaches the little bronze hook. Readable rod, hook, fish, water in a compact open crescent composition. No fishing reel, no bobber, no fisherman, no scenery, no horse and no chess object. The fish must be a simple elegant fish with two broad fins, not a dragon/koi tattoo or patterned ornament. Water and silk/line give the dominant indigo category accent. Keep line visually substantial enough to survive 56px reduction, no hair-thin filigree.
```

### highAnglerHorse

```text
Use case: stylized-concept. Asset type: ONE premium Chinese xiangqi game UI icon, hand-painted raster illustration, readable at 56–80 CSS pixels.
Art direction: contemporary Chinese 国风 game icon craft, restrained 工笔重彩, softly carved shapes and subtle mineral-pigment modeling, decisive ink-dark contour and pale warm edge highlights. Compact expressive silhouette, elegant controlled brush rhythm and negative space. Consistent with the supplied chariot icon in quality, texture, contour weight and level of modeling, but establish a DISTINCT HORSE CATEGORY PALETTE: rich indigo #365b94, mineral blue #82a6cd, pale warm ivory #ede5d2, deep blue-black ink #252e43, very small muted champagne-bronze accents #a68a58. Indigo/blue is the dominant accent. No red, vermilion, orange, turquoise or green accents. Not photorealistic, not plastic, not generic Western fantasy loot.
Canvas: square, actual transparent alpha background. Isolated standalone artwork; all content inside central 84% with clear margin. No background disc, frame, badge, rectangle, scenery, ground shadow, glow, labels, writing or watermark. No board, palace geometry, move arrows, chess pieces, horse-head chess knights or chess pedestals. No Western shields, crowns, European armor, heraldry, dragons, pagodas, lanterns or arbitrary cultural decoration. Chinese horse forms should have a strong rounded neck and torso, lively swept mane and compact natural proportions, not a unicorn or a chess knight.
Generate exactly one finished icon.
Input image: supporting STYLE AND PALETTE reference only, the newly generated double-horses icon. Match its painted indigo/ivory finish. Create only the completely different composition below; do not import the paired horses or water unless specifically requested.
Subject: 高钓马, 'high angling', clearly differentiated from the low-water angler icon. A short steeply arching ivory-bamboo rod with rich indigo silk-wrapped lower grip rises almost vertically from lower-left and bends sharply across the TOP. A taut dark-indigo fishing line descends from its high tip to a LARGE silver-and-mineral-blue carp suspended high at upper-right, its body rising in a lively vertical curve, tail at mid-height, and a small bronze hook at its mouth. Below the fish, leave a conspicuous OPEN GAP before TWO detached broad pale-blue water droplets at the very bottom; no pool or water-wave base. Top-heavy tall hook silhouette expressing lifting and height, not a second version of the low-water composition. Large fish upper-right, grip lower-left. No reel, no figure, no landscape, no horse. Broad painted forms, indigo-blue accent, no fine patterns.
```

### octagonalHorse

```text
Use case: stylized-concept. Asset type: ONE premium Chinese xiangqi game UI icon, hand-painted raster illustration, readable at 56–80 CSS pixels.
Art direction: contemporary Chinese 国风 game icon craft, restrained 工笔重彩, softly carved shapes and subtle mineral-pigment modeling, decisive ink-dark contour and pale warm edge highlights. Compact expressive silhouette, elegant controlled brush rhythm and negative space. Consistent with the supplied chariot icon in quality, texture, contour weight and level of modeling, but establish a DISTINCT HORSE CATEGORY PALETTE: rich indigo #365b94, mineral blue #82a6cd, pale warm ivory #ede5d2, deep blue-black ink #252e43, very small muted champagne-bronze accents #a68a58. Indigo/blue is the dominant accent. No red, vermilion, orange, turquoise or green accents. Not photorealistic, not plastic, not generic Western fantasy loot.
Canvas: square, actual transparent alpha background. Isolated standalone artwork; all content inside central 84% with clear margin. No background disc, frame, badge, rectangle, scenery, ground shadow, glow, labels, writing or watermark. No board, palace geometry, move arrows, chess pieces, horse-head chess knights or chess pedestals. No Western shields, crowns, European armor, heraldry, dragons, pagodas, lanterns or arbitrary cultural decoration. Chinese horse forms should have a strong rounded neck and torso, lively swept mane and compact natural proportions, not a unicorn or a chess knight.
Generate exactly one finished icon.
Input image: supporting STYLE AND PALETTE reference only, the newly generated double-horses icon. Match its painted indigo/ivory finish. Create only the completely different composition below; do not import the paired horses or water unless specifically requested.
Subject: 八角马, an original eight-faceted horse fan emblem. ONE open Chinese folding fan with EIGHT broad sharply pleated indigo-blue panels making an angular spreading upper silhouette, narrow pale ivory rib edges and a small simple bronze pivot at bottom. Across the fan face is ONE bold pale-ivory silhouette of a running full-body Chinese horse, painted in fluid restrained ink-and-mineral-pigment manner; the horse is the main motif and spans most of the fan, with blue shaded modeling, clearly distinguishable head, flowing mane, four legs and tail. The folds interrupt the painting subtly without hiding the horse. A single short indigo silk tie trails from the pivot. Three-quarter angle, asymmetrically fanned shape, elegant small-object game icon. No writing, no bagua, no yin-yang, no arrows, no palace lines, no octagon diagram, no circular medal, no chess token. Treat the fan as a functional expressive object, not ornamental cultural clutter. Exactly one fan and one painted horse.
```

### springHorseMate

```text
Use case: stylized-concept. Asset type: ONE premium Chinese xiangqi game UI icon, hand-painted raster illustration, readable at 56–80 CSS pixels.
Art direction: contemporary Chinese 国风 game icon craft, restrained 工笔重彩, softly carved shapes and subtle mineral-pigment modeling, decisive ink-dark contour and pale warm edge highlights. Compact expressive silhouette, elegant controlled brush rhythm and negative space. Consistent with the supplied chariot icon in quality, texture, contour weight and level of modeling, but establish a DISTINCT HORSE CATEGORY PALETTE: rich indigo #365b94, mineral blue #82a6cd, pale warm ivory #ede5d2, deep blue-black ink #252e43, very small muted champagne-bronze accents #a68a58. Indigo/blue is the dominant accent. No red, vermilion, orange, turquoise or green accents. Not photorealistic, not plastic, not generic Western fantasy loot.
Canvas: square, actual transparent alpha background. Isolated standalone artwork; all content inside central 84% with clear margin. No background disc, frame, badge, rectangle, scenery, ground shadow, glow, labels, writing or watermark. No board, palace geometry, move arrows, chess pieces, horse-head chess knights or chess pedestals. No Western shields, crowns, European armor, heraldry, dragons, pagodas, lanterns or arbitrary cultural decoration. Chinese horse forms should have a strong rounded neck and torso, lively swept mane and compact natural proportions, not a unicorn or a chess knight.
Generate exactly one finished icon.
Input image: supporting STYLE AND PALETTE reference only, the newly generated double-horses icon. Match its painted indigo/ivory finish. Create only the completely different composition below; do not import the paired horses or water unless specifically requested.
Subject: 拔簧马, released stored tension expressed as ONE compact ancient Chinese wooden crossbow just loosing its bolt. Recognizably Chinese hand crossbow: a straight narrow indigo-lacquer wooden stock angled lower-left to upper-right, wide curved ivory-bamboo bow limbs lashed across the front with simple blue cord, tiny bronze trigger fitting, no modern gun grip, no steel stirrup, no telescopic sight, no European crank. One short ivory-shafted bronze-tipped bolt has just left the top-right of the stock; a SMALL VISIBLE GAP separates it from the weapon. The string has sprung forward, and one broad curling indigo silk-like painted motion stroke follows the limb's release at lower-left. Bow and released bolt visually communicate sudden freedom and recoil. Keep extremely simple chunky readable silhouette, original painted game icon rather than technical schematic. No coil spring, no horse head decoration, no figures, no blood, no target. Indigo wood, ivory bow, tiny bronze fittings.
```

### doubleHorsesMate

```text
Use case: stylized-concept. Asset type: ONE premium Chinese xiangqi game UI icon, hand-painted raster illustration, readable at 56–80 CSS pixels.
Art direction: contemporary Chinese 国风 game icon craft, restrained 工笔重彩, softly carved shapes and subtle mineral-pigment modeling, decisive ink-dark contour and pale warm edge highlights. Compact expressive silhouette, elegant controlled brush rhythm and negative space. Consistent with the supplied chariot icon in quality, texture, contour weight and level of modeling, but establish a DISTINCT HORSE CATEGORY PALETTE: rich indigo #365b94, mineral blue #82a6cd, pale warm ivory #ede5d2, deep blue-black ink #252e43, very small muted champagne-bronze accents #a68a58. Indigo/blue is the dominant accent. No red, vermilion, orange, turquoise or green accents. Not photorealistic, not plastic, not generic Western fantasy loot.
Canvas: square, actual transparent alpha background. Isolated standalone artwork; all content inside central 84% with clear margin. No background disc, frame, badge, rectangle, scenery, ground shadow, glow, labels, writing or watermark. No board, palace geometry, move arrows, chess pieces, horse-head chess knights or chess pedestals. No Western shields, crowns, European armor, heraldry, dragons, pagodas, lanterns or arbitrary cultural decoration. Chinese horse forms should have a strong rounded neck and torso, lively swept mane and compact natural proportions, not a unicorn or a chess knight.
Generate exactly one finished icon.
Input image: supporting STYLE reference only. Do not reuse its wheels, ribbons or colors.
Subject: 双马饮泉, TWO horses drinking from the same little spring. Two distinct gracefully curved horse heads, necks and forequarters leaning inward from upper-left and upper-right to a small curling indigo spring at bottom center. One pale ivory horse with blue shaded facets, one slate-mineral-blue horse with ivory edges, both with deep indigo manes and delicate small bronze bridle fittings. Both muzzles are lowered to the water, two separate horse faces plainly visible; a narrow clear gap between the heads. The manes and spring make a balanced but gently asymmetric broad U silhouette. The little spring is two broad painted blue water curls with ivory highlights, NOT a stone bowl or trough, not a whole landscape. Horses occupy 80% of the artwork; water only anchors the bottom. No legs required; crop anatomy intentionally at shoulders into fluid painted curves, not floating decapitated heads. No repeating little decorative details.
```
