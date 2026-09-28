# General puzzle-theme artwork

Original artwork generated with the built-in OpenAI image-generation tool for LiXiangQi. The previous `whiteFacedGeneral.svg` placeholder was not opened or used as a visual reference.

## Meaning and research

The existing label **White Faced General (白脸将)** remains unchanged. Chinese instructional sources identify 白脸将, 对面笑 and 千里照面 with the same family of mating ideas: the opposing commanders cannot face one another unobstructed, so one commander can deny escape while another piece attacks.

The sources establish the tactical meaning much more securely than a literal explanation of the word 白. They do not establish a connection to white face paint or to a pale complexion. This design therefore does not make that connection or assert an unverified etymology. The Chinese names 对面笑 and 千里照面 supply the imagery of a direct, threatening encounter.

“White Faced General” is also used by the World Xiangqi Federation. An essay hosted by WXF explicitly discusses choosing that English name among translations of the three Chinese synonyms. This is evidence of established use, not proof that it captures every connotation; the artwork is not presented as correcting a proven translation error.

The Xiangqi Museum offers an evocative account of royal confrontation and submission. That is useful interpretive context, but the icon does not claim that account as a demonstrated historical origin of the rule.

## Visual direction

### The Xiang Yu and Liu Bang story

The crossbow encounter at 广武 is recorded in the Chinese historical text 《史记》. Its 高祖本纪 describes 项羽's crossbow attack wounding 刘邦 in the chest; 刘邦 conceals the seriousness of the wound and survives. The same annals separately describe the later stray-arrow wound during the campaign against 英布, followed by his final illness. Treating the first wound as the one that led to his death combines separate events.

The Xiangqi Museum explicitly retells the 广武 episode as an explanation of the facing-commanders rule. This establishes that it is a story told within Chinese xiangqi culture. It does not establish the historical causal link: the historical account itself does not say that a xiangqi rule was created from it. Chinese museum accounts place the recognizable modern game's formation after a long evolution, reaching its settled form in the Song period. That chronology alone cannot date this individual rule, but it cautions against treating the Han-era invention story as settled history.

The icon therefore uses the well-attested face-to-face threat as its subject. It does not depict a fatal arrow wound or identify the figures as historical portraits of 项羽 and 刘邦.

- [《史记·高祖本纪》, Chinese text](https://ctext.org/shiji/gao-zu-ben-ji/zhs): the two separate wound episodes.
- [《史记·项羽本纪》, Chinese parallel passages](https://ctext.org/text.pl?if=gb&node=4884&remap=gb&show=parallel): the encounter at 广武 and the crossbow attack.
- [Xiangqi Museum: “将帅不见面”规则背后的历史渊源](https://www.xqmuseum.cn/articledetail/354.html): evidence for the rule-origin story's circulation in Chinese xiangqi writing, not independent proof of that origin.
- [国史馆台湾文献馆: 象棋](https://dict.th.gov.tw/detailPage.aspx?ID=2184): evolution and Song-period formation of the familiar game.

### Composition and color

Two mature Chinese commanders face one another in profile, their eyes aligned across a clear space. Their expressions and the unobstructed gap communicate the confrontation without pieces, palace geometry, beams or arrows. This is an original dramatic interpretation of the name, not a legal board position or an instructional diagram.

Amber-gold robes distinguish the general category from cinnabar chariots, indigo horses, malachite cannons and plum soldiers. The left commander has cinnabar-red shoulder armor, a red headband and red ties; the right commander has charcoal-black equivalents. Matching placement and gold trim make the two sides clear while preserving a shared amber identity. The painted surface, ink-dark contour and warm edge highlights connect the icon to the existing artwork family.

Palette: amber `#c79936`, saffron `#dfb854`, pale gold `#ebcd79`, warm ink `#332c22`, ivory `#ede1c7`. These guide the painting, rather than specifying exact flat pixel colors. Both faces use natural warm skin tones. The color distinction comes from their clothing, not white makeup.

Chinese military court caps and restrained lamellar shoulder armor identify commanders. The headwear draws on 武弁/帻 context, simplified for a small game illustration rather than reconstructing a specific dynasty's uniform. No Western crown, heraldry or samurai helmet is used.

## Sources

- [GameTea: 白脸将](https://www.gametea.com/news/201204/2960.html): the facing-commanders rule and the synonym 对面笑.
- [Xiangqi Museum: 白脸将](https://www.xqmuseum.cn/articledetail/192.html): the imagery of confrontation, royal authority and the uneasy face-to-face encounter.
- [WXF: White Faced General Checkmate](https://www.wxf-xiangqi.org/index.php?Itemid=377&catid=267&id=1025:basic-kills-01-white-faced-general-checkmate&lang=en&option=com_content&view=article): existing English usage, 对面笑, and Wang Ge's humorous “Look of Death” description.
- [WXF-hosted essay on xiangqi translation, PDF page 16](https://www.wxf-xiangqi.org/images/hangzhou-chess/0126_4-___20161015.pdf): discusses 白脸将 / 对面笑 / 千里照面 and the author's choice of “White Faced General.”
- [National Museum of China: 笼冠陶俑](https://www.chnmuseum.cn/zp/zpml/kgfjp/202111/t20211111_252109.shtml): describes the 武弁 military cap and cloth 帻 beneath it.
- The site's lesson and description in `translation/source/puzzleTheme.xml` and `PuzzleThemeLesson.scala` establish its use of the general to prevent escape.

These sources supplied cultural and tactical context. No external artwork was passed to the generator. LiXiangQi's newly generated soldier-on-throne artwork was supplied only as a rendering reference; the subject, adult proportions and amber palette are new.

## Delivery

Canonical asset: `public/images/puzzle-themes/whiteFacedGeneral.webp`, 256 × 256 with transparent alpha, quality 90. Generated colors and alpha are preserved during proportional downsampling, with visible artwork centered inside a 236 × 236 area. Near-invisible alpha noise is ignored only when determining crop bounds.

The same file serves light and dark themes through the existing brush-ring mounts. `PuzzleTheme.iconFile` supplies it to the themes page and puzzle sidebar. The old dedicated SVG and its cached copy are removed. Translation files, card styling and the other icon groups are unchanged.

## Generation and final color-edit prompts

### Base artwork

```text
Use case: stylized-concept.
Asset type: ONE premium Chinese xiangqi game UI icon, transparent painted raster illustration, legible at 56–126 CSS pixels.
Primary request: An original interpretation of 白脸将 / 对面笑 / 千里照面 through the commanding gaze of TWO opposing Chinese generals facing each other. This is a psychological confrontation, not a white-painted face or a chess diagram.
Reference image: supporting RENDERING STYLE reference only. Adopt its hand-painted mineral-pigment texture, ink-dark contours, modeled sculptural volume and warm edge highlights. Do not copy the young figure, throne, dragon carving, seated pose or plum palette.
Style: sophisticated contemporary Chinese 国风 digital-game icon craft, restrained 工笔重彩, softly painted lacquer and metal, broad readable shapes, deliberate negative space. More mature and commanding facial proportions than the reference, not anime or cute chibi, not photorealism, not flat vector or glossy plastic.
GENERAL CATEGORY PALETTE: dominant amber-gold/ochre #c79936, saffron silk #dfb854, pale gold #ebcd79, deep warm ink-brown #332c22 and muted warm ivory #ede1c7. Amber is the large colored area in both commanders' robes and headwear bindings. No red/cinnabar, indigo/blue, malachite green or plum/purple accents. Deep brown supplies shadow rather than making an all-black icon. Skin is natural warm tan on BOTH figures, not white face makeup and not a light-versus-dark skin contrast.
Subject and composition: two mature Chinese commander HEAD-AND-SHOULDER BUSTS, left commander facing RIGHT in strict side profile, right commander facing LEFT in strict side profile. Their clearly visible eyes look directly toward each other's eye at the same height across an UNOBSTRUCTED transparent central gap. Both faces must be large enough to read: a bold eye, composed mouth, strong brow, sculpted nose. Left commander has a short neatly pointed dark beard and calm assurance; right has a short moustache and alert restrained resolve. Two distinct adults, not a mirrored duplicate and not a comical grin. Heads remain separated by about 15% of the total artwork width; no nose touching, no kissing pose, nothing between them.
Headwear and clothing: simplified Han-era Chinese 武弁 military court caps over wrapped 帻 cloth, dark lacquer/ink surfaces with amber bands, compact rounded rectangular cap outline hugging the top/back of the head, modest side straps. These are Chinese command caps, not Western helmets, European crowns, tall graduation caps, samurai kabuto, long antennae or horned helmets. Collared amber robes visible below each face; one broad band of understated Chinese lamellar shoulder armor provides commander identity. No hands, weapons, medals, eagles, shield or unrelated dragons. Amber silk folds sweep gently outward below the shoulders, creating a compact balanced pair of irregular silhouettes without a pedestal or frame. Both commanders together form ONE wide compact icon, not two separately boxed portraits.
Canvas: square with genuine transparent alpha, all artwork within central 84%, generous clear margin on every side, no clipped garment tips. No background scenery, opaque white/black rectangle, halo, enclosing medallion, circle, badge, throne, board, palace geometry, chess pieces, tokens, eye beam, laser, arrow, motion line, lettering, inscriptions, caption or watermark. Convey the confronting gaze purely by faces and negative space. Preserve crisp two-tone edge separation on both charcoal and off-white UI. Generate exactly ONE finished icon.
```

### Final faction-color edit

```text
Use case: precise-object-edit.
Edit the attached LiXiangQi two-commanders icon. Change ONLY faction-identifying armor and cloth colors. Preserve the exact two faces, expressions, eye-to-eye gaze, face proportions, opposing poses, headwear shapes, garment shapes, painted texture, lighting, transparent gap, transparent background and overall composition.
The two characters represent the RED general on the LEFT and BLACK general on the RIGHT. Make that distinction unambiguous without abandoning the amber-gold general-category palette.
LEFT commander, facing right: change the broad visible shoulder's lamellar armor plates to rich CINNABAR RED #ad3527, with deeper red shadows, and KEEP all gold raised rims, rivets and edge glints. Change the narrow forehead binding/headband and the trailing cloth ties behind his head to the SAME cinnabar red. The main cap crown remains dark ink with gold edging. His large main robe/cape drapery MUST STAY AMBER-GOLD, not turn red.
RIGHT commander, facing left: change the corresponding shoulder's lamellar armor plates, forehead binding and trailing head ties to unmistakable CHARCOAL BLACK #242321 with soft warm gray modeling. Keep gold trim, rivets and edge glints so the black surfaces remain readable on a dark theme. His large main robe/cape drapery MUST STAY AMBER-GOLD, not turn black.
Overall amber/saffron/gold should remain the dominant shared color and about two-thirds of the colored costume area. Faction colors appear in matching, substantial armor panels and matching narrow bindings so viewers can immediately compare them. Do not use red on the right or black armor plates on the left. No extra flags, characters, written labels, piece tokens, symbols, emblems, weapons or decorative elements. Keep both natural warm skin tones exactly as in the reference; no white or colored face makeup.
Preserve the sophisticated Chinese hand-painted digital icon finish. Both whole busts must remain fully contained with clear transparent margins. No background, medallion or baked-in brush ring. Genuine transparent alpha. Deliver ONE final edited icon.
```
