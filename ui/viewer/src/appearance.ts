import { boardAssets } from '@lixiangqi/board';

/** A viewer's appearance is scoped to its own container, independent of account preferences. */
export function applyViewerAppearance(
  root: HTMLElement,
  assetUrl: (path: string) => string,
  boardKey: string = boardAssets.defaultBoard,
  pieceKey: string = boardAssets.defaultPieces,
): void {
  const board = boardAssets.boards.find(theme => theme.key === boardKey);
  const families = boardAssets.pieceSets.find(theme => theme.key === pieceKey)?.variants;
  const pieces = families?.xiangqi;
  if (!board || !pieces) throw new Error('Unknown board or piece theme');
  const assets: Record<string, string> = {
    '---board-image': board.geometries['xiangqi-9x10'],
    '--xiangqi-rest-shadow-image': boardAssets.shadows.rest,
    '--xiangqi-airborne-shadow-image': boardAssets.shadows.airborne,
  };
  for (const [side, path] of Object.entries(pieces.back)) assets[`--board-piece-back-${side}`] = path;
  for (const [geometry, path] of Object.entries(board.geometries))
    assets[`---board-image-${geometry}`] = path;
  for (const [side, roles] of Object.entries(pieces.faces))
    for (const [role, path] of Object.entries(roles)) assets[`---${side}-${role}`] = path;
  for (const [family, set] of Object.entries(families))
    if (family !== 'xiangqi')
      for (const [side, roles] of Object.entries(set.faces))
        for (const [role, path] of Object.entries(roles)) assets[`---${family}-${side}-${role}`] = path;
  // CSS fetches the board and faces actually used by this position.
  for (const [key, path] of Object.entries(assets))
    root.style.setProperty(key, `url("${assetUrl(path).replaceAll('"', '%22')}")`);
  root.style.setProperty('---cg-ccw', board.coordinateLight);
  root.style.setProperty('---cg-ccb', board.coordinateDark);
  for (const name of ['opacity', 'brightness', 'contrast', 'saturation'])
    root.style.setProperty(`---board-${name}`, '100');
  root.style.setProperty('---board-hue', '0');
  root.dataset.board = boardKey;
  root.dataset.pieceSet = pieceKey;
  root.classList.add('board-assets-ready');
}
