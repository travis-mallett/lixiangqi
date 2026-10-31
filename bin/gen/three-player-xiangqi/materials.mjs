import assert from 'node:assert/strict';

import {
  apothem,
  faceRadius,
  fmt,
  height,
  hexagon,
  line,
  margin,
  polygon,
  radius,
  width,
} from './geometry.mjs';

const serialize = element => element.outerHTML.replaceAll(' xmlns="http://www.w3.org/2000/svg"', '');

export function tournamentMaterial(doc) {
  // Preserve source illumination stops and their normalized positions.
  const defs = ['global-light-bloom', 'global-light-vignette', 'global-light-direction'].map(id =>
    serialize(doc.getElementById(id)),
  );
  const outer = hexagon(faceRadius),
    inner = hexagon(faceRadius - (2 * 5.75) / Math.sqrt(3));
  const bevel = [];
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    const midpoint = outer[i].map((n, k) => (n + outer[j][k]) / 2);
    const inward = inner[i].map((n, k) => (n + inner[j][k]) / 2);
    const light = midpoint[0] + midpoint[1] < 0;
    const source = doc.getElementById(light ? 'bevel-matched-top' : 'bevel-matched-bottom').cloneNode(true);
    source.id = `three-player-bevel-${i}`;
    source.setAttribute('gradientUnits', 'userSpaceOnUse');
    for (const [key, value] of Object.entries({
      x1: midpoint[0],
      y1: midpoint[1],
      x2: inward[0],
      y2: inward[1],
    }))
      source.setAttribute(key, fmt(value));
    for (const stop of source.children) stop.removeAttribute('id');
    defs.push(serialize(source));
    bevel.push(`<path d="${polygon([outer[i], outer[j], inner[j], inner[i]])}" fill="url(#${source.id})"/>`);
    bevel.push(
      `<path d="${line([outer[i], outer[j]])}" fill="none" stroke="#674126" stroke-width="1" opacity="${light ? '.10' : '.22'}"/>`,
    );
  }
  for (const [inset, color, stroke, opacity] of [
    [2.645, '#ffe5a8', 1.15, '.12'],
    [5.06, '#87552e', 1.035, '.05'],
  ])
    bevel.push(
      `<path d="${polygon(hexagon(faceRadius - (2 * inset) / Math.sqrt(3)))}" fill="none" stroke="${color}" stroke-width="${stroke}" opacity="${opacity}"/>`,
    );
  return {
    defs: defs.join('\n'),
    content: `<g transform="scale(${fmt(width / 900)} ${fmt(height / 1000)})">${serialize(doc.getElementById('rect37'))}${serialize(doc.getElementById('g40'))}</g>${bevel.join('\n')}`,
  };
}

/** Affine source-triangle → destination-triangle map, in SVG matrix order. */
function affine(source, destination) {
  const [p, q, r] = source,
    [a, b, c] = destination;
  const ux = q[0] - p[0],
    uy = q[1] - p[1],
    vx = r[0] - p[0],
    vy = r[1] - p[1];
  const determinant = ux * vy - uy * vx;
  assert.ok(Math.abs(determinant) > 1e-6);
  const rows = [0, 1].map(k => [
    ((b[k] - a[k]) * vy - (c[k] - a[k]) * uy) / determinant,
    ((c[k] - a[k]) * ux - (b[k] - a[k]) * vx) / determinant,
  ]);
  const matrix = [
    rows[0][0],
    rows[1][0],
    rows[0][1],
    rows[1][1],
    a[0] - rows[0][0] * p[0] - rows[0][1] * p[1],
    a[1] - rows[1][0] * p[0] - rows[1][1] * p[1],
  ];
  for (let i = 0; i < 3; i++)
    for (let k = 0; k < 2; k++)
      assert.ok(
        Math.abs(
          matrix[k] * source[i][0] + matrix[k + 2] * source[i][1] + matrix[k + 4] - destination[i][k],
        ) < 1e-8,
      );
  return matrix.map(fmt).join(' ');
}

export function wudangMaterial(doc) {
  const image = doc.querySelector('image');
  const href = image.getAttribute('href');
  assert.ok(href.startsWith('data:image/png;base64,'));
  // A continuous 18-triangle SVG mesh reuses the original PNG byte for byte.
  // Separate inner/outer rings keep its border at the existing piece scale.
  const rectangle = (x, y) => [
    [x, 0],
    [x, y],
    [-x, y],
    [-x, 0],
    [-x, -y],
    [x, -y],
  ];
  const sourceOuter = rectangle(450, 500),
    sourceInner = rectangle(392, 441);
  const destinationOuter = hexagon(faceRadius),
    destinationInner = hexagon(radius);
  const triangles = [];
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    triangles.push(
      [
        [[0, 0], sourceInner[i], sourceInner[j]],
        [[0, 0], destinationInner[i], destinationInner[j]],
      ],
      [
        [sourceOuter[i], sourceOuter[j], sourceInner[j]],
        [destinationOuter[i], destinationOuter[j], destinationInner[j]],
      ],
      [
        [sourceOuter[i], sourceInner[j], sourceInner[i]],
        [destinationOuter[i], destinationInner[j], destinationInner[i]],
      ],
    );
  }
  const defs = [
    `<image id="three-player-wudang-source" x="-450" y="-500" width="900" height="1000" preserveAspectRatio="none" href="${href}"/>`,
  ];
  const content = [];
  triangles.forEach(([source, destination], i) => {
    // Expand each clip by <1 final unit to cover raster antialiasing seams.
    // The shared outer face clips the overscan at the physical board edge.
    const center = destination[0].map((_, k) => destination.reduce((sum, p) => sum + p[k], 0) / 3);
    const clip = destination.map(p => p.map((n, k) => center[k] + (n - center[k]) * 1.0015));
    defs.push(`<clipPath id="wudang-material-tile-${i}"><path d="${polygon(clip)}"/></clipPath>`);
    content.push(
      `<g clip-path="url(#wudang-material-tile-${i})"><use href="#three-player-wudang-source" transform="matrix(${affine(source, destination)})"/></g>`,
    );
  });
  assert.equal(triangles.length, 18);
  assert.ok(Math.abs(apothem + margin - height / 2) < 1e-9);
  return { defs: defs.join('\n'), content: content.join('\n') };
}

export function paperMaterial(doc) {
  const color = doc.getElementById('rect1').getAttribute('fill');
  return { defs: '', content: `<path d="${polygon(hexagon(faceRadius))}" fill="${color}"/>` };
}
