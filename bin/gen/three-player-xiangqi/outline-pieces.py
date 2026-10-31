"""Optional authoring step; normal piece generation uses the committed SVG outlines.

Usage: python outline-pieces.py /path/to/FZLSK.TTF /path/to/TW-Kai-98_1.ttf
Requires fontTools. No font programs or runtime fonts are shipped with the pieces.
"""
import sys
from pathlib import Path
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

entries = []
for family, filename in zip(("lishu", "kai"), sys.argv[1:], strict=True):
    font = TTFont(filename)
    expected = {"lishu": "FZLiShu-S01", "kai": "TW-Kai"}[family]
    assert expected in [n.toUnicode() for n in font["name"].names if n.nameID == 1], filename
    glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
    for name, character in dict(wei="魏", wu="吳", shu="蜀", elephant="向", cannon="礮", soldier="勇").items():
        glyph = glyphs[cmap[ord(character)]]
        bounds, path = BoundsPen(glyphs), SVGPathPen(glyphs)
        glyph.draw(bounds)
        glyph.draw(path)
        x0, y0, x1, y1 = bounds.bounds
        scale = 1 / max(x1 - x0, y1 - y0)
        entries.append(f'<g id="{family}-{name}" aria-label="{character}" '
                       f'transform="scale({scale} {-scale}) translate({-(x0+x1)/2} {-(y0+y1)/2})">'
                       f'<path d="{path.getCommands()}"/></g>')

Path(__file__).with_name("piece-glyphs.svg").write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-.5 -.5 1 1"><title>Three Kingdoms piece lettering</title>'
    '<desc>Six fixed inscriptions in two lettering styles: FZLiShu-S01 / 方正隶书_GBK '
    '(Founder, clerical lettering), and TW-Kai 98.1 '
    '(數位發展部，CNS11643中文標準交換碼全字庫網站，https://www.cns11643.gov.tw; '
    'Government Open Data License v1.0, https://www.cns11643.gov.tw/pageView.jsp?ID=59). '
    'Document outlines only; no font program. Centered by exact ink bounds, longest '
    'ink dimension one. Set-specific fitting and weight are owned by three-player-pieces.mjs.</desc><defs>'
    + "\n".join(entries) + '</defs></svg>\n', encoding="utf-8")
