import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

import {
  faceRadius,
  fmt,
  geometryMetadata,
  gridSegments,
  height,
  hexagon,
  labelUses,
  line,
  marker,
  palaceSegments,
  polygon,
  radius,
  sectors,
  validateGeometry,
  width,
} from '../three-player-xiangqi/geometry.mjs';
import { document, engraving, lettering, stone } from './material.mjs';

export function threePlayer() {
  validateGeometry();
  const glyphs = new JSDOM(
    readFileSync(new URL('../three-player-xiangqi/wudang-glyphs.svg', import.meta.url), 'utf8'),
    { contentType: 'image/svg+xml' },
  );
  const glyphDefs = glyphs.window.document.querySelector('defs').innerHTML;
  glyphs.window.close();
  const face = polygon(hexagon(faceRadius));
  const framePath = offset => polygon(hexagon(radius + (2 * offset) / Math.sqrt(3)));
  const frame = (offset, attrs) => `<path d="${framePath(offset)}" ${attrs}/>`;
  const marks = sectors
    .flatMap((_, sector) => [
      ...[1, 7].map(file => marker(file, 2, sector, 5, 20)),
      ...[0, 2, 4, 6, 8].map(file => marker(file, 3, sector, 5, 20)),
    ])
    .join('');
  return document({
    title: 'Three Kingdoms',
    width: fmt(width),
    height: fmt(height),
    viewBox: `${fmt(-faceRadius)} ${fmt(-height / 2)} ${fmt(width)} ${fmt(height)}`,
    metadata: `<metadata id="three-player-geometry">${JSON.stringify(geometryMetadata)}</metadata>`,
    defs: `<clipPath id="stone-face"><path d="${face}"/></clipPath>${glyphDefs}
  <g id="engraving"><path id="three-player-grid" d="${gridSegments.map(line).join('')}"/><path id="three-player-palaces" d="${palaceSegments.map(line).join('')}"/><path id="three-player-position-marks" d="${marks}"/></g>
  <g id="letters" aria-label="魏、吳、蜀；荊州、赤壁、祁山">${labelUses().join('')}</g>`,
    content: `<g clip-path="url(#stone-face)">
    ${stone(fmt(width), fmt(height), 'xMidYMid slice', fmt(-faceRadius), fmt(-height / 2))}
    <path d="${face}${framePath(20)}" fill="#25322e" fill-opacity=".32" fill-rule="evenodd"/>
  </g>
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    ${frame(20, 'stroke="#252e2b" stroke-width="6"')}
    ${frame(20, 'stroke="url(#frame-edge)" stroke-width="3"')}
    ${frame(9.5, 'stroke="#d1d1c7" stroke-width="1" opacity=".55"')}
    ${frame(8, 'stroke="#313a34" stroke-width="2"')}
    ${engraving}
  </g>${lettering}`,
  });
}
