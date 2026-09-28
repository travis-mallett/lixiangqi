# Soldier puzzle-theme artwork

Original artwork generated with the built-in OpenAI image-generation tool for LiXiangQi. The previous soldier-category placeholders were not opened or used as visual references.

## Visual direction

Plum lacquer, warm copper and ivory distinguish the soldier category from the cinnabar chariots, indigo horses and malachite cannons. The dark contours, painted material modeling and pale edge highlights preserve the established family style. These four icons use paired objects, a military assemblage, a figurative seat and a shrine to create varied silhouettes.

Palette: plum `#80506f`, mulberry `#493045`, dusty lilac `#ba93b0`, copper `#bb885e`, ivory `#ede2ca`. These are generation directions, not exact uniform pixel colors. The plum finish is an artistic category treatment, not a claim about historical materials.

## Meaning and interpretation

| Method     | Xiangqi meaning                                                                                              | Visual interpretation                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 二鬼拍门   | Two advanced soldiers cooperate to break through beside the advisor.                                         | Two characterful Chinese beast-face ring knockers, one lifted as if knocking, on small fragments of door timber. |
| 三车闹士   | Advanced soldiers gain the attacking force of chariots. The site's lesson uses one chariot and two soldiers. | One chariot wheel supported by two Chinese infantry dagger-axes, expressing three cooperating attackers.         |
| 小鬼坐龙廷 | A humble soldier occupies the palace center and restricts the general while another piece finishes.          | A small plain-clothed soldier confidently occupies an oversized Chinese dragon throne.                           |
| 送佛归殿   | A supported soldier advances repeatedly and drives the general back to its original rank.                    | An ivory Buddha within an open plum shrine, with broad steps leading back inside.                                |

These are original metaphors based on the Chinese names and tactical content. They are not board diagrams, replicas of archaeological objects or claims of traditional fixed emblems.

The Xiangqi Museum discusses paired door guardians in its 二鬼拍门 article. The icon interprets this association through Chinese 铺首衔环, combining two expressive faces with the act of knocking. The knockers are architectural objects, not depictions of the guardians themselves or a claim that the name originated with these objects.

For 三车闹士, the two infantry weapons deliberately retain the soldiers' role. The icon does not imply that three literal chariot pieces are required. The wheel and two weapons show the cooperative attack; an additional advisor figure would make the small image needlessly crowded.

For 小鬼坐龙廷, the contrast between a modest soldier and an elaborate seat expresses the weak piece taking command. The word 龙 directly motivates the throne's restrained dragon armrests. The little figure is a metaphorical soldier, not a Western ghost, a crowned ruler or a literal demonic creature.

For 送佛归殿, the open shrine and inward thresholds supply the sense of return. Chinese Buddhist sculptural forms provide context for the figure and lotus seat; the icon is a compact poetic object, not a religious or architectural reconstruction.

## Chinese source context

- [Xiangqi Museum: 二鬼拍门](https://www.xqmuseum.cn/articledetail/194.html): cooperation between small soldiers and an association with paired Chinese door guardians.
- [Palace Museum: 铺首](https://www.dpm.org.cn/lemmas/245425.html): the beast-face mount and its ring.
- [National Museum of China: gilt bronze ring knocker](https://www.chnmuseum.cn/zp/zpml/kgfjp/202111/t20211116_252293.shtml): architectural function, animal-mask form and knocking.
- [GameTea: 小鬼坐龙庭](https://www.gametea.com/news/201204/2989.html): explains the soldier as 小鬼 and the central place of authority as 龙庭.
- [GameTea: 三进兵 / 送佛归殿](https://www.gametea.com/news/201204/2991.html): supported advances driving the general back.
- [National Museum of China: Shang bronze weapons](https://www.chnmuseum.cn/yj/xscg/xslw/201812/t20181224_33281.shtml): Chinese infantry weapon families, including the 戈.
- [National Museum of China: bronze 戈](https://www.chnmuseum.cn/zp/zpml/csp/202008/t20200826_247348.shtml): material and form context for the dagger-axes.
- [Shenyang Palace Museum: carved dragon throne](https://www.sypm.org.cn/product_1/1161617437480943616.html): the back, armrests, seat and footrest as parts of the Chinese throne.
- [National Museum of China: ancient Chinese Buddhist sculpture](https://www.chnmuseum.cn/portals/0/web/zt/buddhist_sculpture/content.html): Chinese sculptural treatment of robes, Buddha figures and lotus seats.
- The site's exact methods and combinations were checked in `translation/source/puzzleTheme.xml` and `modules/puzzle/src/main/ui/PuzzleThemeLesson.scala`.

Sources supply contextual evidence rather than designs to copy. No third-party artwork was passed to the generator. The original LiXiangQi cannon crown icon supplied the rendering-style reference for the knockers and wheel; its green palette was explicitly replaced by plum. The new knockers supplied the soldier palette and painting reference for the throne and shrine.

## Delivery

Four canonical 256 × 256 transparent WebP assets in `public/images/puzzle-themes/`, quality 90. The original generated alpha and painted colors are preserved during proportional downsampling. Visible artwork is centered in a 236 × 236 area; near-invisible alpha noise is ignored only for determining crop bounds.

The existing theme-aware brush-ring mounts, theme colors and card layout supply presentation on both themes. `PuzzleTheme.iconFile` supplies each canonical filename to the themes page and puzzle sidebar. The dedicated `centroidPawnMate.svg` placeholder is removed. The shared `mix.svg` remains for other themes that still use it. No separate light/dark artwork or obsolete asset fallback is shipped. Browser review uses the production page CSS at desktop, intermediate and mobile widths.

## Final generation prompts

### doubleGhostsKnocking

```text
Use case: stylized-concept.
Asset type: ONE premium Chinese xiangqi game UI icon, hand-painted raster art legible at 43–72 CSS pixels.
Art direction: contemporary Chinese 国风 digital-game icon craft, restrained 工笔重彩, carved lacquer, softly modeled painted volume, decisive ink-dark contours, subtle mineral-pigment texture and warm ivory edge highlights. Match the reference's sophisticated object illustration, brush finish and contour scale. Not flat vector, not glossy plastic, not photorealistic, not a generic Western fantasy loot icon.
SOLDIER CATEGORY PALETTE: dominant rich warm aubergine/plum lacquer #80506f and mulberry shadow #493045, pale dusty-lilac highlights #ba93b0, warm copper #bb885e and warm ivory #ede2ca. Plum must read clearly purple, never blue/indigo, red/cinnabar or green/teal. Copper is restrained structural trim, not an all-gold icon. A two-tone dark/pale edge treatment should separate the art from both ivory and charcoal UI.
Canvas: square, genuine transparent alpha, compact isolated motif with 8% transparent margins, all elements fully contained. No baked-in circle, disc, badge, background, floor shadow or frame around the whole icon. The UI supplies its own circular mount. No text, inscriptions, logos or watermark. No xiangqi tokens, board, palace grid, move arrows or tactical diagram. No Western chess forms, heraldic shields, pointed crowns, European plate armor, Halloween sheet ghosts, Japanese oni masks or samurai styling. Avoid excess detail, tiny ornamental clutter, gratuitous dragons or generic cultural decoration. Generate exactly ONE finished icon.
Input image: supporting RENDERING STYLE reference only. Adopt its painterly finish, NOT its objects or green palette. Use the new soldier palette and subject below.
Subject: 二鬼拍门. TWO Chinese beast-face ring knockers, 铺首衔环, characterful but elegant, one slightly upper-left and one slightly lower-right, both facing outward in a lively paired rhythm. Each is a sculptural warm-plum lacquer mask with copper brows, a broad short nose, large stylized curled eyebrows, compact curling cheek forms and one round COPPER KNOCKING RING held in its mouth. Two faces, exactly two rings, separate and clearly countable. Use Chinese bronze architectural beast-mask language rather than lion portraits or human theatrical face paint. The left ring hangs down and the right ring tilts outward as if just lifted to knock. Each mask sits on a small cropped irregular plum timber sliver, just enough wood to indicate an actual door fitting, no complete doorway, roof or architectural facade. Faces should be bold simple shapes, not horror, snarling goblins, skulls or monsters with long horns. The round open ring interiors give clear negative space. Broad paired diagonal silhouette, strongly purple with restrained copper rings and edges. This is an original rebus of two spirited visitors knocking, not literal Western ghosts or the Chinese door guardians themselves.
```

### threeChariotsHarassingAdvisor

```text
Use case: stylized-concept.
Asset type: ONE premium Chinese xiangqi game UI icon, hand-painted raster art legible at 43–72 CSS pixels.
Art direction: contemporary Chinese 国风 digital-game icon craft, restrained 工笔重彩, carved lacquer, softly modeled painted volume, decisive ink-dark contours, subtle mineral-pigment texture and warm ivory edge highlights. Match the reference's sophisticated object illustration, brush finish and contour scale. Not flat vector, not glossy plastic, not photorealistic, not a generic Western fantasy loot icon.
SOLDIER CATEGORY PALETTE: dominant rich warm aubergine/plum lacquer #80506f and mulberry shadow #493045, pale dusty-lilac highlights #ba93b0, warm copper #bb885e and warm ivory #ede2ca. Plum must read clearly purple, never blue/indigo, red/cinnabar or green/teal. Copper is restrained structural trim, not an all-gold icon. A two-tone dark/pale edge treatment should separate the art from both ivory and charcoal UI.
Canvas: square, genuine transparent alpha, compact isolated motif with 8% transparent margins, all elements fully contained. No baked-in circle, disc, badge, background, floor shadow or frame around the whole icon. The UI supplies its own circular mount. No text, inscriptions, logos or watermark. No xiangqi tokens, board, palace grid, move arrows or tactical diagram. No Western chess forms, heraldic shields, pointed crowns, European plate armor, Halloween sheet ghosts, Japanese oni masks or samurai styling. Avoid excess detail, tiny ornamental clutter, gratuitous dragons or generic cultural decoration. Generate exactly ONE finished icon.
Input image: supporting RENDERING STYLE reference only. Adopt its painterly finish, NOT its objects or green palette. Use the new soldier palette and subject below.
Subject: 三车闹士. An emblem of ONE chariot and TWO foot soldiers joining forces, expressed through one large plum-lacquered six-spoked CHARIOT WHEEL and TWO early Chinese infantry 戈 dagger-axes. The wheel occupies the lower middle, shown in slight three-quarter perspective, dark copper rim, large simple open spaces between spokes, plum wood. Behind it, two dark wooden pole shafts fan apart in a shallow V, their blade heads separately visible upper-left and upper-right. Each ge is the distinctive Chinese form: a horizontal tapered bronze/copper blade projecting SIDEWAYS at a right angle to the shaft, with a short rear tang; NO forward spearpoint, NO European crescent halberd, NO trident. Left blade points outward left, right blade outward right. The shafts end a little below the wheel; one short plum cloth tie at each blade binding supplies rhythm. Compact triangular silhouette, two clearly separate weapon heads and one clearly separate wheel. The two humble infantry weapons standing beside the wheel communicate the soldiers becoming chariot-strength attackers. Do not add a helmet, throne, enemy, shield, face, flags, extra wheel or chariot carriage. No board or military formation diagram.
```

### centroidPawnMate

```text
Use case: stylized-concept.
Asset type: ONE premium Chinese xiangqi game UI icon, hand-painted raster art legible at 43–72 CSS pixels.
Art direction: contemporary Chinese 国风 digital-game icon craft, restrained 工笔重彩, carved lacquer, softly modeled painted volume, decisive ink-dark contours, subtle mineral-pigment texture and warm ivory edge highlights. Match the reference's sophisticated object illustration, brush finish and contour scale. Not flat vector, not glossy plastic, not photorealistic, not a generic Western fantasy loot icon.
SOLDIER CATEGORY PALETTE: dominant rich warm aubergine/plum lacquer #80506f and mulberry shadow #493045, pale dusty-lilac highlights #ba93b0, warm copper #bb885e and warm ivory #ede2ca. Plum must read clearly purple, never blue/indigo, red/cinnabar or green/teal. Copper is restrained structural trim, not an all-gold icon. A two-tone dark/pale edge treatment should separate the art from both ivory and charcoal UI.
Canvas: square, genuine transparent alpha, compact isolated motif with 8% transparent margins, all elements fully contained. No baked-in circle, disc, badge, background, floor shadow or frame around the whole icon. The UI supplies its own circular mount. No text, inscriptions, logos or watermark. No xiangqi tokens, board, palace grid, move arrows or tactical diagram. No Western chess forms, heraldic shields, pointed crowns, European plate armor, Halloween sheet ghosts, Japanese oni masks or samurai styling. Avoid excess detail, tiny ornamental clutter, gratuitous dragons or generic cultural decoration. Generate exactly ONE finished icon.
Input image: supporting RENDERING STYLE reference only. Adopt its painterly finish, NOT its objects or green palette. Use the new soldier palette and subject below.
Subject: 小鬼坐龙廷. A diminutive bold COMMON FOOT SOLDIER has cheekily taken the seat of power: a small ivory-and-plum carved human figurine sitting confidently on an oversized Chinese dragon throne. Whole motif should look like one richly painted carved miniature, not a scene or character portrait. The soldier has a compact adult body, simple wrapped plum tunic, ivory face and lower arms, dark hair in ONE small high topknot, softly angular brows and an assured expression. His plain clothing contrasts with the rich throne. No imperial robe, crown, helmet, weapon, beard, horns or demonic anatomy. Not a baby, anime chibi, Buddha or Western goblin. One forearm rests on an armrest, one boot extends casually, showing this humble little figure occupying the grand seat.
Throne: authentic Chinese three-panel screen-back 宝座, broad horizontal back, square seat, low footrest, four short curved feet, two short sculpted Chinese dragon-head armrest ends. Dominant plum lacquer with restrained warm copper carving highlights. The dragon forms are directly motivated by 龙廷, restrained and simplified, no huge dragon body or extra dragon ornament. Three-quarter front view, compact WIDE silhouette, figure large enough to be readable but smaller than the throne. Clear ivory face and forearms, strong dark outline; seat remains clearly recognizable at 43px. No tall European throne, tufted upholstery, pointed Gothic back or crown.
The supplied image is the NEW plum soldier-family icon: follow this image's plum and warm copper palette closely as well as its painted finish. Do NOT copy its beast masks, rings or timber fragments. Any human face in this icon must be a calm human face; no facial resemblance to the reference beasts.
```

### repatriationOfBuddha

```text
Use case: stylized-concept.
Asset type: ONE premium Chinese xiangqi game UI icon, hand-painted raster art legible at 43–72 CSS pixels.
Art direction: contemporary Chinese 国风 digital-game icon craft, restrained 工笔重彩, carved lacquer, softly modeled painted volume, decisive ink-dark contours, subtle mineral-pigment texture and warm ivory edge highlights. Match the reference's sophisticated object illustration, brush finish and contour scale. Not flat vector, not glossy plastic, not photorealistic, not a generic Western fantasy loot icon.
SOLDIER CATEGORY PALETTE: dominant rich warm aubergine/plum lacquer #80506f and mulberry shadow #493045, pale dusty-lilac highlights #ba93b0, warm copper #bb885e and warm ivory #ede2ca. Plum must read clearly purple, never blue/indigo, red/cinnabar or green/teal. Copper is restrained structural trim, not an all-gold icon. A two-tone dark/pale edge treatment should separate the art from both ivory and charcoal UI.
Canvas: square, genuine transparent alpha, compact isolated motif with 8% transparent margins, all elements fully contained. No baked-in circle, disc, badge, background, floor shadow or frame around the whole icon. The UI supplies its own circular mount. No text, inscriptions, logos or watermark. No xiangqi tokens, board, palace grid, move arrows or tactical diagram. No Western chess forms, heraldic shields, pointed crowns, European plate armor, Halloween sheet ghosts, Japanese oni masks or samurai styling. Avoid excess detail, tiny ornamental clutter, gratuitous dragons or generic cultural decoration. Generate exactly ONE finished icon.
Input image: supporting RENDERING STYLE reference only. Adopt its painterly finish, NOT its objects or green palette. Use the new soldier palette and subject below.
Subject: 送佛归殿. A small serene IVORY BUDDHA FIGURE welcomed back into a compact Chinese wooden shrine 佛龛. Readable poetic return-to-the-hall motif, NOT a game diagram. One modest seated Buddha with simple Chinese sculptural robe folds, rounded ushnisha hair shape, two hands resting quietly in the lap, upright calm posture, no jeweled crown and no multiple arms. Figure occupies nearly half of the icon height and sits on a low copper-and-plum lotus seat just inside the shrine opening. The shrine is deep plum lacquer with warm copper edge fittings: two short open side-door leaves angle outward toward the viewer, a shallow single Chinese tiled canopy with gently lifted corners, and TWO broad low ivory threshold steps leading INWARD to the Buddha. The open doors and inward steps convey return; no arrows, procession, soldiers or whole building. Close compact vertical object silhouette; the pale figure and steps are separated from dark plum wood. Door panels plain with only one large recessed panel each. No dense decoration, tall pagoda, Gothic arch, generic temple landscape, circular halo/backdrop, incense cloud, lotus flowers floating around it or writing. Dignified simplified miniature; style and detail scale must match the other soldier icons.
The supplied image is the NEW plum soldier-family icon: follow this image's plum and warm copper palette closely as well as its painted finish. Do NOT copy its beast masks, rings or timber fragments. Any human face in this icon must be a calm human face; no facial resemblance to the reference beasts.
```
