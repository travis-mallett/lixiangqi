import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

import { standardXiangqi, miniXiangqi } from '../../../ui/board/src/definitions.ts';
import { boardLayout } from '../../../ui/board/src/layout.ts';
import { document, engraving, lettering, stone } from './material.mjs';

const fmt = n => Number(n.toFixed(3));

function river(left, top, cell) {
  const dom = new JSDOM(readFileSync(new URL('./river.svg', import.meta.url), 'utf8'), {
    contentType: 'image/svg+xml',
  });
  // Trace coordinates are relative to reference grid bounds (25,20)..(703,780).
  const labels = [
    ['chu', 108, 369],
    ['he', 210, 369],
    ['han', 461, 373],
    ['jie', 572, 369],
  ]
    .map(([id, a, b]) => {
      const x = fmt(left + ((a - 25) * cell * 8) / 678);
      const y = fmt(top + ((b - 20) * cell * 9) / 760);
      const path = dom.window.document.querySelector(`#${id} path`).getAttribute('d');
      return `<path id="river-${id}" transform="translate(${x} ${y}) scale(${fmt((cell * 8) / 678)} ${fmt((cell * 9) / 760)})" d="${path}"/>`;
    })
    .join('\n');
  dom.window.close();
  return labels;
}

function rectangle({ title, geometry, labels = false }) {
  const { columns, rows, placement, frame } = geometry;
  const { cellSize: cell, marginX: left, marginY: top } = frame;
  const cells = placement === 'cells';
  const { canvasWidth: width, canvasHeight: height } = cells
    ? { canvasWidth: columns * cell + 2 * left, canvasHeight: rows * cell + 2 * top }
    : boardLayout(geometry);
  const lastFile = cells ? columns : columns - 1;
  const lastRank = cells ? rows : rows - 1;
  const x = file => left + file * cell;
  const y = rank => top + rank * cell;
  const grid = [
    ...Array.from({ length: lastRank + 1 }, (_, rank) => `M${x(0)} ${y(rank)}H${x(lastFile)}`),
    ...Array.from({ length: lastFile + 1 }, (_, file) =>
      labels
        ? `M${x(file)} ${y(0)}V${y(4)}M${x(file)} ${y(5)}V${y(9)}`
        : `M${x(file)} ${y(0)}V${y(lastRank)}`,
    ),
    ...(labels ? [`M${x(0)} ${y(4)}V${y(5)}M${x(lastFile)} ${y(4)}V${y(5)}`] : []),
  ].join('');
  const palaceLeft = (columns - 3) / 2;
  const palaces = cells
    ? ''
    : [0, rows - 3]
        .map(
          rank =>
            `M${x(palaceLeft)} ${y(rank)}L${x(palaceLeft + 2)} ${y(rank + 2)}M${x(palaceLeft + 2)} ${y(rank)}L${x(palaceLeft)} ${y(rank + 2)}`,
        )
        .join('');
  const mark = (file, rank) =>
    [-1, 1]
      .flatMap(dx =>
        [-1, 1].map(dy => {
          if ((file === 0 && dx === -1) || (file === lastFile && dx === 1)) return '';
          return `M${x(file) + dx * 5} ${y(rank) + dy * 20}V${y(rank) + dy * 5}H${x(file) + dx * 20}`;
        }),
      )
      .join('');
  const marks = labels
    ? [2, 7]
        .flatMap(rank => [1, 7].map(file => mark(file, rank)))
        .concat([3, 6].flatMap(rank => [0, 2, 4, 6, 8].map(file => mark(file, rank))))
        .join('')
    : '';
  const rect = (offset, attributes) =>
    `<rect x="${left - offset}" y="${top - offset}" width="${lastFile * cell + 2 * offset}" height="${lastRank * cell + 2 * offset}" ${attributes}/>`;
  // Use the same continuous-path representation as the other Mini themes.
  const printedGrid =
    !labels && !cells
      ? Array.from(
          { length: columns },
          (_, i) => `M${x(i)},${y(0)}V${y(lastRank)}M${x(0)},${y(i)}H${x(lastFile)}`,
        ).join('')
      : grid;
  const printedPalaces = !labels && !cells ? palaces.replaceAll(' ', ',') : palaces;
  return document({
    title,
    width,
    height,
    metadata: `<metadata id="board-geometry">${JSON.stringify({ geometry: geometry.id, width, height, columns, rows, placement, cellSize: cell, marginX: left, marginY: top, ...(labels ? { river: [y(4), y(5)] } : {}) })}</metadata>`,
    defs: `<g id="engraving"><path id="${labels ? 'grid-lines' : 'gridlines'}" d="${printedGrid}"/><path id="palaces" d="${printedPalaces}"/><path id="position-marks" d="${marks}"/></g>${labels ? `<g id="letters">${river(left, top, cell)}</g>` : ''}`,
    content: `${stone(width, height, labels ? 'none' : 'xMidYMid slice')}
  <path d="M0 0H${width}V${height}H0ZM${left - 20} ${top - 20}V${height - top + 20}H${width - left + 20}V${top - 20}Z" fill="#25322e" fill-opacity=".32" fill-rule="evenodd"/>
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    ${rect(20, 'stroke="#252e2b" stroke-width="6"')}
    ${rect(20, 'stroke="url(#frame-edge)" stroke-width="3"')}
    ${rect(9.5, 'stroke="#d1d1c7" stroke-width="1" opacity=".55"')}
    ${rect(8, 'stroke="#313a34" stroke-width="2"')}
    ${engraving}
  </g>${labels ? lettering : ''}`,
  });
}

export const standard = () =>
  rectangle({ title: 'Xiangqi', geometry: standardXiangqi.geometry, labels: true });
export const mini = () => rectangle({ title: 'Mini Xiangqi', geometry: miniXiangqi.geometry });
// Banqi artwork is prepared alongside the existing theme assets. Its runtime is
// deferred: it is not a registered board definition or a new playable variant.
export const banqi = () =>
  rectangle({
    title: 'Banqi',
    geometry: {
      id: 'banqi-4x8',
      columns: 4,
      rows: 8,
      placement: 'cells',
      frame: { cellSize: 100, marginX: 48, marginY: 48 },
    },
  });
