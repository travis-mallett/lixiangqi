"""Optional authoring: outline-banner.py FZLSK.TTF TW-Kai-98_1.ttf.

Normal generation uses the committed outlines, without fonts or Python packages.
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
    glyphs = font.getGlyphSet()
    glyph = glyphs[font.getBestCmap()[ord("旗")]]
    bounds, path = BoundsPen(glyphs), SVGPathPen(glyphs)
    glyph.draw(bounds)
    glyph.draw(path)
    x0, y0, x1, y1 = bounds.bounds
    scale = 1 / max(x1 - x0, y1 - y0)
    entries.append(f'<g id="{family}-banner" aria-label="旗" '
                   f'transform="scale({scale} {-scale}) translate({-(x0+x1)/2} {-(y0+y1)/2})">'
                   f'<path d="{path.getCommands()}"/></g>')

Path(__file__).with_name("glyphs.svg").write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-.5 -.5 1 1"><title>Manchu Banner lettering</title>'
    '<desc>Fixed inscription in FZLiShu-S01 (Founder, clerical lettering) and TW-Kai 98.1 '
    '(Ministry of Digital Affairs, CNS11643, https://www.cns11643.gov.tw; Government Open Data '
    'License v1.0, https://www.cns11643.gov.tw/pageView.jsp?ID=59). Document outlines only; '
    'no font program. Fitting and weight follow the shared piece lettering generator.</desc><defs>'
    + "\n".join(entries) + '</defs></svg>\n', encoding="utf-8")
