import { readFileSync, writeFileSync } from 'node:fs';

// Consume the approved artwork metadata verbatim; this generator never changes the board artwork.
const svg = readFileSync(
  new URL('../../public/images/board/svg/lixiangqi-default-three-player.svg', import.meta.url),
  'utf8',
);
const metadata = JSON.parse(svg.match(/<metadata id="three-player-geometry">(.*?)<\/metadata>/s)[1]);
const { width, height } = metadata.canvas;
const geometry = {
  id: 'three-player-xiangqi-135',
  width,
  height,
  pieceSize: metadata.pieceCanvas,
  rotations: { red: 120, black: 0, green: 240 },
  locations: Object.fromEntries(
    metadata.locations.map(({ id, center: [x, y] }) => [id, [x + width / 2, y + height / 2]]),
  ),
};
writeFileSync(
  new URL('../../ui/board/src/three-player-geometry.json', import.meta.url),
  JSON.stringify(geometry, null, 2) + '\n',
);
