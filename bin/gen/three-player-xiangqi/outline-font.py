"""Optional lettering authoring: python outline-font.py THEME /path/to/font.ttf.

Requires fontTools only when changing the committed nine-glyph SVG fixtures.
Normal board generation uses those fixtures and requires no font installation.
"""

import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

theme, filename = sys.argv[1:]
profiles = {
    "tournament": ("JetLink BoldRightJang", 1, 1),
    "wudang": ("TW-Kai", .79, .62),
    "paper": ("UnYetgul", 1, 1),
}
family, sx, sy = profiles[theme]
# The Wudang source contains emboldened, integer-rounded CNS Kai outlines.
# Match that ink weight, not the considerably lighter unemboldened font face.
# 22 font units was calibrated against all four existing source inscriptions.
stroke = 22 if theme == "wudang" else 0
font = TTFont(filename)
assert family in [n.toUnicode() for n in font["name"].names if n.nameID == 1]
if theme == "tournament":
    # The legacy source has three trailing zero loca entries for empty slots.
    # Correct those in memory; all nine requested glyphs precede these slots.
    # No glyph bytes are altered and no font program is emitted.
    offsets = font["loca"].locations
    if list(offsets[-3:]) == [0, 0, 0]:
        for index in range(len(offsets) - 3, len(offsets)):
            offsets[index] = offsets[-4]

glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
labels = dict(wei="魏", wu="吳", shu="蜀", jing="荊", zhou="州", chi="赤", bi="壁", qi="祁", shan="山")
entries = []
for name, character in labels.items():
    glyph_name = cmap[ord(character)]
    if theme == "tournament":
        assert font.getGlyphID(glyph_name) < len(font["loca"].locations) - 4
    glyph = glyphs[glyph_name]
    bounds = BoundsPen(glyphs)
    glyph.draw(bounds)
    x0, y0, x1, y1 = bounds.bounds
    pen = SVGPathPen(glyphs)
    glyph.draw(pen)
    scale = 1 / max((x1 - x0 + stroke) * sx, (y1 - y0 + stroke) * sy)
    weight = f' stroke="currentColor" stroke-width="{stroke}" stroke-linejoin="round"' if stroke else ""
    entries.append(
        f'<g id="{name}" aria-label="{character}" '
        f'transform="scale({scale * sx} {-scale * sy}) '
        f'translate({-(x0 + x1) / 2} {-(y0 + y1) / 2})">'
        f'<path d="{pen.getCommands()}"{weight}/></g>'
    )

credits = {
    "tournament": "JetLink BoldRightJang / 超世紀粗方篆, matching xiangqi-tournament.svg. Only nine document glyphs; the font program is not included.",
    "wudang": "全字庫正楷體 / TW-Kai 98.1. 數位發展部，CNS11643中文標準交換碼全字庫網站，https://www.cns11643.gov.tw。 Government Open Data License v1.0. Original Wudang lettering aspect correction: 0.79 horizontally, 0.62 vertically; matched ink weight: 22 font units.",
    "paper": "UnYetgul (Unfonts-extra), Koaunghi Un and Won-kyu Park, GPL-2.0-or-later. Source: https://ctan.org/pkg/unfonts-extra. See UnYetgul.LICENSE.txt.",
}
output = Path(__file__).parent / f"{theme}-glyphs.svg"
output.write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-.5 -.5 1 1">'
    f'<title>{theme} three-player board lettering</title><desc>{credits[theme]} '
    'Glyphs centered by exact ink bounds; longest ink dimension 1. No runtime font. '
    'See public/images/board/svg/three-player-themes.design.md.</desc><defs>'
    + "\n".join(entries) + "</defs></svg>\n",
    encoding="utf-8",
)
print(output)
