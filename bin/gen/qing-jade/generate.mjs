// The masters and all shipped artwork are vector paths. Run with --check to
// compare every delivery SVG against the masters without modifying the tree.
import { JSDOM } from 'jsdom';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const readSvg = file => {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  return new JSDOM(source, { contentType: 'image/svg+xml' }).window.document;
};
const carvings = readSvg('carvings.svg');
const kingdoms = readSvg('../three-player-xiangqi/piece-glyphs.svg');
const banners = readSvg('../manchu/glyphs.svg');
const dest = new URL('../../../public/piece/qing-jade/', import.meta.url);
const check = process.argv.includes('--check');

const ivory = {
  face: ['#aa987c', '#b6a48a', '#bfaf94', '#c8b89f'],
  wall: ['#9b8669', '#baaa8e', '#beae93', '#b1a086', '#79674f'],
  pigment: ['#80432f', '#985039', '#ae6749'],
  glint: ['#dcccb4', '#f0e2cd'],
};
const nephrite = {
  face: ['#292c29', '#30322f', '#393b37', '#454741'],
  wall: ['#22251f', '#30332d', '#4b4d46', '#51534c', '#2b2d29'],
  pigment: ['#9e7b43', '#dfb863', '#ffecaa'],
  glint: ['#95968c', '#dddcd3'],
};
const celadon = {
  face: ['#638b70', '#719b7d', '#81ab8b', '#90b693'],
  wall: ['#456c59', '#78a386', '#86af90', '#769c7e', '#486957'],
  pigment: ['#1e392a', '#2a5138', '#395d41'],
  glint: ['#aec6ac', '#d3decb'],
};
const neutral = {
  face: ['#828780', '#93978d', '#a1a499', '#b1b2a6'],
  wall: ['#686c62', '#93978b', '#9fa295', '#919487', '#63685e'],
  pigment: ['#666b61', '#767a6e', '#888d7f'],
  glint: ['#c4c6b9', '#dfdfd3'],
};
const materials = { r: ivory, b: nephrite, g: celadon, neutral };

function gradient(id, colors, offsets, direction) {
  return (
    `<linearGradient id="${id}" ${direction}>` +
    colors.map((color, i) => `<stop offset="${offsets[i]}" stop-color="${color}"/>`).join('') +
    '</linearGradient>'
  );
}

function paintedTrace(id, colors) {
  const master = carvings.getElementById(id);
  if (!master) throw Error(`Missing Qing Jade trace ${id}`);
  return [...master.children]
    .map(path => {
      const layer = Number(path.getAttribute('class').split('-')[1]);
      return `<path fill="${colors[layer]}" d="${path.getAttribute('d')}"/>`;
    })
    .join('\n');
}

function bodyMaterial(material, donor) {
  const defs = [
    gradient('wall', material.wall, [0, 0.64, 0.83, 0.965, 1], 'x2="0" y2="1"'),
    gradient('stone', material.face, [0, 0.36, 0.75, 1], 'x1=".34" x2=".63" y2="1"'),
    '<radialGradient id="edge" cx=".50" cy=".46" r=".55"><stop offset=".91" stop-opacity="0"/><stop offset=".98" stop-opacity=".035"/><stop offset="1" stop-opacity=".2"/></radialGradient>',
    '<radialGradient id="wall-light" cx=".62" cy=".86" r=".62"><stop stop-color="#fff" stop-opacity=".11"/><stop offset=".62" stop-opacity="0"/><stop offset="1" stop-opacity=".13"/></radialGradient>',
    '<clipPath id="body-clip"><circle cx="50" cy="50" r="45"/></clipPath>',
  ];
  const body = [
    '<circle data-piece-body="true" cx="50" cy="50" r="45" fill="url(#wall)"/>',
    '<g clip-path="url(#body-clip)">',
    '<circle cx="50" cy="50" r="45" fill="url(#wall-light)"/>',
    '<ellipse cx="50" cy="44.15" rx="44.8" ry="39.25" fill="url(#stone)"/>',
    '<circle cx="50" cy="50" r="45" fill="url(#edge)"/>',
    `<g id="stone-grain" opacity="${donor === 'b' ? '.085' : '.055'}">${paintedTrace(donor + 'Stone', ['#000', '#fff'])}</g>`,
    `<g id="inlaid-ring">${paintedTrace(donor + 'Ring', material.pigment)}</g>`,
    `<g id="polished-lip">${paintedTrace(donor + 'Lip', material.glint)}</g>`,
    '</g>',
  ];
  return { defs, body };
}

function variantLetter(name, material, defs) {
  const source = (name === 'banner' ? banners : kingdoms).getElementById('kai-' + name);
  if (!source) throw Error(`Missing outlined variant character ${name}`);
  const glyph = source.cloneNode(true);
  glyph.removeAttribute('id');
  const path = glyph.querySelector('path');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '8');
  path.setAttribute('stroke-linejoin', 'round');
  const [shade, mid, light] = material.pigment;
  defs.push(
    `<g id="letter" transform="translate(50 43.63) scale(57.75 54.38)">${glyph.outerHTML}</g>`,
    gradient('inlay', [mid, light, mid, shade, mid], [0, 0.3, 0.46, 0.73, 1], 'x2=".72" y2="1"'),
    '<clipPath id="letter-clip"><use href="#letter"/></clipPath>',
    `<pattern id="inlay-grain" width="3" height="10.5" viewBox="5 5 3 10.5" patternUnits="userSpaceOnUse" patternTransform="rotate(-27)">${paintedTrace((material === nephrite ? 'b' : 'r') + 'Inlay', [shade, light])}</pattern>`,
  );
  return (
    `<use href="#letter" fill="${shade}" color="${shade}" transform="translate(.22 .35)"/>` +
    `<use href="#letter" fill="${light}" color="${light}" transform="translate(-.15 -.2)"/>` +
    `<use href="#letter" fill="url(#inlay)" color="${mid}"/>` +
    '<path clip-path="url(#letter-clip)" fill="url(#inlay-grain)" opacity=".42" d="M10 7h80v74H10z"/>'
  );
}

function piece(code, character, role, extra) {
  const side = code === 'Back' ? 'neutral' : code[0];
  const material = materials[side],
    donor = side === 'b' ? 'b' : 'r';
  const { defs, body } = bodyMaterial(material, donor);
  if (character) {
    const ink = extra ? variantLetter(extra, material, defs) : paintedTrace(donor + role, material.pigment);
    body.push(`<g id="inscription" aria-label="${character}">${ink}</g>`);
  }
  const output = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">',
    `<title>Qing Jade — ${character ?? 'Concealed'}</title>`,
    '<defs>',
    ...defs,
    '</defs>',
    ...body,
    '</svg>',
    '',
  ].join('\n');
  const file = new URL(`${code}.svg`, dest);
  if (check) {
    if (readFileSync(file, 'utf8') !== output) throw Error(`Stale Qing Jade artwork: ${code}`);
  } else writeFileSync(file, output);
}

if (!check) mkdirSync(dest, { recursive: true });
for (const [side, labels] of [
  ['r', '帥士相馬車砲卒'],
  ['b', '將士象馬車砲兵'],
]) {
  for (const [i, role] of [...'KABNRCP'].entries()) piece(side + role, labels[i], role);
  piece(side + 'M', '旗', null, 'banner');
}
for (const [role, label] of [
  ['A', '士'],
  ['N', '馬'],
  ['R', '車'],
])
  piece('g' + role, label, role);
for (const [code, label, glyph] of [
  ['rK3', '蜀', 'shu'],
  ['bK3', '魏', 'wei'],
  ['gK', '吳', 'wu'],
  ['gB', '向', 'elephant'],
  ['gC', '礮', 'cannon'],
  ['gP', '勇', 'soldier'],
])
  piece(code, label, null, glyph);
for (const code of ['rBack', 'bBack', 'gBack', 'Back']) piece(code);
for (const doc of [carvings, kingdoms, banners]) doc.defaultView.close();
console.log(`${check ? 'Verified' : 'Generated'} 29 Qing Jade SVGs.`);
