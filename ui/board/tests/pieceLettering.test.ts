import { Resvg } from '@resvg/resvg-js';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const labels = { rK3: '蜀', bK3: '魏', gK: '吳', gB: '向', gC: '礮', gP: '勇' };

// Final canvas coordinates, measured from each existing set's face/ring.
const faces = {
  'default-wood': { center: [49.53, 46.015], innerRadius: 35.18, clearance: 2 },
  'xiangqi-paper-traditional': { center: [50, 50], innerRadius: 41.8, clearance: 3 },
  'xiangqi-wudang': { center: [50, 50], innerRadius: 38.69, clearance: 1.8 },
  'xiangqi-white': { center: [50, 50], innerRadius: 34.2, clearance: 2.5 },
};

for (const [set, face] of Object.entries(faces))
  test(`${set}: Three Kingdoms lettering is centered on the face and clears its ring`, () => {
    for (const [piece, label] of Object.entries(labels)) {
      const file = `${set}/${piece}.svg`;
      const dom = new JSDOM(readFileSync(new URL(`../../../public/piece/${file}`, import.meta.url), 'utf8'), {
        contentType: 'image/svg+xml',
      });
      try {
        const doc = dom.window.document;
        const root = doc.documentElement;
        const symbol = doc.getElementById('three-kingdoms-symbol');
        assert.ok(symbol, file);
        assert.equal(symbol.getAttribute('aria-label'), label, file);
        assert.equal(doc.querySelectorAll('text').length, 0, `${file}: runtime font dependency`);

        // Isolate ink but keep every ancestor transform. This catches the old
        // double transform, which inspecting the glyph alone would miss.
        let node: Element = symbol;
        while (node !== root) {
          const parent = node.parentElement!;
          for (const sibling of Array.from(parent.children)) if (sibling !== node) sibling.remove();
          node = parent;
        }
        const options = { font: { loadSystemFonts: false } };
        const bounds = new Resvg(root.outerHTML, options).getBBox()!;
        assert.ok(
          Math.abs(bounds.x + bounds.width / 2 - face.center[0]) < 0.02,
          `${file}: horizontal center`,
        );
        assert.ok(Math.abs(bounds.y + bounds.height / 2 - face.center[1]) < 0.02, `${file}: vertical center`);
        const longest = Math.max(bounds.width, bounds.height);
        const minimum = set === 'xiangqi-white' ? 46 : 48;
        assert.ok(longest >= minimum && longest <= 61, `${file}: unexpected ink size ${longest}`);

        // Check actual painted contours, including weight and the dark Wudang
        // edge. A wide glyph can fit a rectangle yet still cross a circular ring.
        const size = 400;
        const { pixels } = new Resvg(root.outerHTML, {
          ...options,
          fitTo: { mode: 'width', value: size },
        }).render();
        let radius = 0;
        for (let y = 0; y < size; y++)
          for (let x = 0; x < size; x++)
            if (pixels[(y * size + x) * 4 + 3] > 127)
              radius = Math.max(
                radius,
                Math.hypot((x + 0.5) / 4 - face.center[0], (y + 0.5) / 4 - face.center[1]),
              );
        assert.ok(radius <= face.innerRadius - face.clearance, `${file}: ink touches the ring (${radius})`);
      } finally {
        dom.window.close();
      }
    }
  });
