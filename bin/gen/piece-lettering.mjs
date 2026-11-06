import { Resvg } from '@resvg/resvg-js';
import { JSDOM } from 'jsdom';

const parse = source => new JSDOM(source, { contentType: 'image/svg+xml' }).window.document;

// These coordinates belong to the artwork, before the shared piece-body transform.
// Fit the new ink once. The original symbol's transform is specific to that old
// character, so it must never wrap a replacement glyph.
const letteringStyles = {
  'default-wood': {
    family: 'lishu',
    center: [45.585438, 42.485431],
    box: [52, 43],
    radius: 29,
    aspect: 1.3,
    weight: 3,
  },
  'xiangqi-paper-traditional': {
    family: 'lishu',
    center: [46, 46],
    box: [55, 43],
    radius: 36,
    aspect: 1.2,
    weight: 0,
  },
  'xiangqi-wudang': { family: 'kai', center: [50, 50], box: [64, 64], radius: 39.8, aspect: 1, weight: 24 },
};

function inkRadius(artwork, bounds) {
  // A rectangular fit alone is insufficient for a circular face: wide diagonal
  // strokes can still collide with its ring. Measure painted ink at authoring
  // time, with a conservative half-pixel allowance. The output stays pure SVG.
  const size = 512;
  const { x, y, width, height } = bounds;
  const pixels = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
      `viewBox="${x} ${y} ${width} ${height}" preserveAspectRatio="none">${artwork}</svg>`,
    { font: { loadSystemFonts: false } },
  ).render().pixels;
  let radius = 0;
  for (let row = 0; row < size; row++)
    for (let col = 0; col < size; col++)
      if (pixels[(row * size + col) * 4 + 3])
        radius = Math.max(
          radius,
          Math.hypot(((col + 0.5) / size - 0.5) * width, ((row + 0.5) / size - 0.5) * height),
        );
  return radius + Math.hypot(width, height) / (2 * size);
}

export function lettering(source, set, name, glyphs, symbolId) {
  const doc = parse(source);
  const style = letteringStyles[set];
  const template = glyphs.getElementById(`${style.family}-${name}`);
  if (!template) throw new Error(`Missing ${style.family} lettering for ${name}`);
  const glyph = doc.importNode(template, true);
  glyph.removeAttribute('id');
  const wrapper = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
  wrapper.id = symbolId;
  wrapper.setAttribute('aria-label', glyph.getAttribute('aria-label'));
  wrapper.append(glyph);
  const path = glyph.querySelector('path');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', style.weight);
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('paint-order', 'stroke fill');
  // Include the weight when fitting; otherwise dense glyphs can touch the ring.
  const artwork = `<g transform="scale(1 ${style.aspect})">${glyph.outerHTML}</g>`;
  const measured = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 2 2">${artwork}</svg>`, {
    font: { loadSystemFonts: false },
  }).getBBox();
  if (!measured) throw new Error(`Empty ${set}/${name} lettering`);
  const scale = Math.min(
    style.box[0] / measured.width,
    style.box[1] / measured.height,
    style.radius / inkRadius(artwork, measured),
  );
  wrapper.setAttribute(
    'transform',
    `translate(${style.center.join(' ')}) scale(${scale}) ` +
      `translate(${-measured.x - measured.width / 2} ${-measured.y - measured.height / 2}) ` +
      `scale(1 ${style.aspect})`,
  );
  let ink;
  if (set === 'default-wood') {
    const symbol = doc.getElementById('symbol');
    ink = symbol.querySelector('path').getAttribute('fill');
    symbol.removeAttribute('transform');
    symbol.replaceChildren(wrapper);
  } else if (set === 'xiangqi-wudang') {
    const artwork = doc.getElementById('piece-artwork');
    const old = [...artwork.children].findLast(n => n.localName === 'path');
    if (!old) throw new Error('Wudang symbol structure changed');
    ink = old.getAttribute('fill');
    // Retain the original fine, translucent dark outline around the ivory ink.
    const edge = path.cloneNode(true);
    const unitScale = Math.abs(Number(glyph.getAttribute('transform').match(/scale\(([^ ]+)/)[1]));
    edge.setAttribute('stroke', old.getAttribute('stroke'));
    edge.setAttribute('stroke-opacity', old.getAttribute('stroke-opacity'));
    edge.setAttribute(
      'stroke-width',
      style.weight + Number(old.getAttribute('stroke-width')) / (scale * unitScale),
    );
    glyph.prepend(edge);
    old.replaceWith(wrapper);
  } else {
    const symbol =
      [...doc.querySelectorAll('#piece-artwork g')].find(g => g.getAttribute('fill')) ??
      doc.querySelector('#piece-artwork path');
    if (!symbol) throw new Error('Paper symbol structure changed');
    ink = symbol.getAttribute('fill') ?? '#000';
    symbol.replaceWith(wrapper);
  }
  wrapper.setAttribute('fill', ink);
  wrapper.setAttribute('color', ink);
  const result = doc.documentElement.outerHTML + '\n';
  doc.defaultView.close();
  return result;
}
