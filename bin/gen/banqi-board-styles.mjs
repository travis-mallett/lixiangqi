import { JSDOM } from 'jsdom';
import { readFileSync, writeFileSync } from 'node:fs';

import { boardTheme } from './board-theme.mjs';

// Banqi has its own material/cell geometry. Synchronize only the printed ink
// with the parent themes, preserving its embedded backgrounds byte for byte.
for (const [variant, parent] of Object.entries({
  default: 'lixiangqi-default',
  paper: 'paper-board',
  tournament: 'xiangqi-tournament',
  wudang: 'xiangqi-wudang',
})) {
  const file = new URL(`../../public/images/board/svg/banqi-${variant}.svg`, import.meta.url);
  const source = new JSDOM(
    readFileSync(new URL(`../../public/images/board/svg/${parent}.svg`, import.meta.url), 'utf8'),
    { contentType: 'image/svg+xml' },
  );
  const dom = new JSDOM(readFileSync(file, 'utf8'), { contentType: 'image/svg+xml' });
  const doc = dom.window.document;
  const style = boardTheme(source.window.document, parent, 100);
  const artwork = doc.getElementById('banqi-artwork');
  artwork.setAttribute('stroke', style.ink);
  artwork.setAttribute('opacity', style.opacity);
  artwork.removeAttribute('filter');
  for (const id of ['banqi-ink', 'banqi-corner-knot', 'banqi-outer-decoration'])
    doc.getElementById(id)?.remove();
  const frame = doc.getElementById('banqi-playing-frame');
  if (style.frame) {
    frame.setAttribute('stroke', style.frame.ink);
    frame.setAttribute('stroke-width', style.frame.width);
    frame.setAttribute('x', 48 - style.frame.offset);
    frame.setAttribute('y', 48 - style.frame.offset);
    frame.setAttribute('width', 400 + 2 * style.frame.offset);
    frame.setAttribute('height', 800 + 2 * style.frame.offset);
  } else frame?.remove();
  doc.getElementById('banqi-grid').setAttribute('stroke-width', style.width);
  // Old hand-authored comments described the superseded engraving and fret.
  const comments = doc.createTreeWalker(doc, dom.window.NodeFilter.SHOW_COMMENT);
  const obsolete = [];
  while (comments.nextNode()) obsolete.push(comments.currentNode);
  obsolete.forEach(node => node.remove());
  doc.querySelector('desc').textContent =
    `Four columns and eight rows of 100-unit square cells. Grid bounds (48,48) to (448,848). Ink, line weights, and playing frame match ${parent}.svg. Styles synchronized by bin/gen/banqi-board-styles.mjs.`;
  writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>\n${doc.documentElement.outerHTML}\n`);
  source.window.close();
  dom.window.close();
}
