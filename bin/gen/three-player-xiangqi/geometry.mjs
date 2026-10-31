import assert from 'node:assert/strict';

// Artwork construction, not a registered game or a rectangular BoardGeometry.
// All dimensions are final SVG units. See the adjacent asset's design record.
export const pitch = 98;
export const radius = 9 * pitch;
export const apothem = (radius * Math.sqrt(3)) / 2;
export const margin = 59; // Perpendicular distance from grid edge to wood edge.
export const faceRadius = radius + (2 * margin) / Math.sqrt(3);
export const width = 2 * faceRadius;
export const height = 2 * (apothem + margin);
export const sectors = ['wei', 'wu', 'shu'];
export const pieceCanvas = pitch;
export const pieceBody = 0.9 * pieceCanvas;

export function rotate([x, y], degrees) {
  const angle = (degrees * Math.PI) / 180;
  return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
}

/** Continuous interpolation for artwork; playable locations use integer f/r. */
export function point(file, rank, sector = 0) {
  assert.ok(file >= 0 && file <= 8 && rank >= 0 && rank <= 4 && sector >= 0 && sector < 3);
  const x = ((file - 4) * pitch * (9 + rank)) / 8;
  const y = apothem * (1 - rank / 5 + (Math.abs(file - 4) * rank) / 45);
  return rotate([x, y], sector * 120);
}

export const hexagon = (r = radius) => Array.from({ length: 6 }, (_, i) => rotate([r, 0], i * 60));
export const positions = sectors.flatMap((sector, s) =>
  Array.from({ length: 5 }, (_, rank) =>
    Array.from({ length: 9 }, (_, file) => ({
      id: `${sector}:${file}:${rank}`,
      sector,
      file,
      rank,
      center: point(file, rank, s),
    })),
  ).flat(),
);

/** Each segment is emitted once; the perimeter owns the outside files/ranks. */
export const gridSegments = (() => {
  const vertices = hexagon();
  const segments = vertices.map((p, i) => [p, vertices[(i + 1) % 6]]);
  for (let s = 0; s < 3; s++) {
    for (let f = 1; f < 8; f++) segments.push([point(f, 0, s), point(f, 4, s)]);
    for (let r = 1; r <= 4; r++) {
      segments.push([point(0, r, s), point(4, r, s)], [point(4, r, s), point(8, r, s)]);
    }
    segments.push([point(4, 4, s), point(4, 4, (s + 1) % 3)]);
  }
  return segments;
})();

// Four corner-to-center edges meet at the existing P(4,1) grid location.
// These undirected edges define the advisor's geometric paths. Opposite
// halves are not collinear: never replace them with corner-to-corner chords.
export const palaceDiagonalEdges = sectors.flatMap(sector =>
  [
    [3, 0],
    [5, 0],
    [3, 2],
    [5, 2],
  ].map(([file, rank]) => [`${sector}:${file}:${rank}`, `${sector}:4:1`]),
);
const positionById = new Map(positions.map(position => [position.id, position]));
export const palaceSegments = palaceDiagonalEdges.map(edge => edge.map(id => positionById.get(id).center));

export const fmt = n => String(Number(n.toFixed(6)));
export const xy = p => p.map(fmt).join(' ');
export const line = points => `M${points.map(xy).join('L')}`;
export const polygon = vertices => `${line(vertices)}Z`;
export const vector = (a, b) => {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
};

export function roundedHexagon(r, trim = 14) {
  const vertices = hexagon(r);
  return (
    vertices
      .map((p, i) => {
        const a = vector(p, vertices[(i + 5) % 6]);
        const b = vector(p, vertices[(i + 1) % 6]);
        return `${i ? 'L' : 'M'}${xy(p.map((v, j) => v + a[j] * trim))}Q${xy(p)} ${xy(p.map((v, j) => v + b[j] * trim))}`;
      })
      .join('') + 'Z'
  );
}

export function marker(file, rank, sector, gap = 5.88, extent = 17.64) {
  const center = point(file, rank, sector);
  const quadrants = [];
  for (const df of [-1, 1]) {
    if (file + df < 0 || file + df > 8) continue;
    const across = vector(center, point(file + df, rank, sector));
    for (const dr of [-1, 1]) {
      const along = vector(center, point(file, rank + dr, sector));
      const offset = (a, b) => center.map((n, i) => n + across[i] * a + along[i] * b);
      // Source-theme marker dimensions in final units, aligned to the local grid.
      quadrants.push(line([offset(extent, gap), offset(gap, gap), offset(gap, extent)]));
    }
  }
  return quadrants.join('');
}

export function validateGeometry() {
  assert.equal(positions.length, 135);
  assert.equal(new Set(positions.map(p => p.center.map(fmt).join(','))).size, 135);
  assert.equal(palaceDiagonalEdges.length, 12);
  for (const sector of sectors) {
    const center = `${sector}:4:1`;
    const corners = palaceDiagonalEdges.filter(([, to]) => to === center).map(([from]) => from);
    assert.equal(corners.length, 4);
    assert.equal(new Set(corners).size, 4);
    for (const corner of corners) {
      const location = positionById.get(corner);
      assert.equal(location.sector, sector);
      assert.equal(Math.abs(location.file - 4), 1);
      assert.equal(Math.abs(location.rank - 1), 1);
    }
  }
  let nearest = Infinity;
  for (let i = 0; i < positions.length; i++)
    for (let j = i + 1; j < positions.length; j++)
      nearest = Math.min(
        nearest,
        Math.hypot(...positions[i].center.map((n, k) => n - positions[j].center[k])),
      );
  assert.ok(Math.abs(nearest - pitch) < 1e-9);
  assert.ok(nearest > pieceBody);
  // Support distance of every piece body to all six unrounded face edges.
  for (const { center } of positions)
    for (let i = 0; i < 6; i++) {
      const normal = rotate([1, 0], 30 + i * 60);
      const clearance = apothem + margin - center[0] * normal[0] - center[1] * normal[1];
      assert.ok(clearance - pieceBody / 2 >= 14.9 - 1e-9);
    }
  return {
    locations: positions.length,
    palaceDiagonals: palaceDiagonalEdges.length,
    minimumCenterDistance: nearest,
    bodyDiameter: pieceBody,
  };
}

export const geometryMetadata = {
  geometry: 'three-player-xiangqi-artwork-v1',
  minimumPitch: pitch,
  backRankPitch: radius / 8,
  gridCircumradius: radius,
  gridApothem: apothem,
  normalBorder: margin,
  pieceCanvas,
  pieceBody,
  canvas: { width, height, origin: 'center', yAxis: 'down' },
  locations: positions,
  palaceDiagonalEdges,
};

export function labelUses() {
  const labels = sectors.map((name, s) => {
    const center = point(4, 1, s);
    return `<use href="#${name}" transform="translate(${xy(center)}) rotate(${s * 120}) scale(${fmt(apothem / 4)})"/>`;
  });
  for (const { degrees, names } of [
    { degrees: 0, names: ['jing', 'zhou'] },
    { degrees: -120, names: ['chi', 'bi'] },
    { degrees: 120, names: ['qi', 'shan'] },
  ])
    for (const [index, name] of names.entries()) {
      const distance = index === 0 ? 0.42 : 0.65;
      const center = rotate([0, -distance * apothem], degrees);
      labels.push(
        `<use href="#${name}" transform="translate(${xy(center)}) rotate(${180 + degrees}) scale(127.4)"/>`,
      );
    }
  return labels;
}
