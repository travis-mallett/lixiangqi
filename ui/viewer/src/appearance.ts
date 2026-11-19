import { boardAssets, type BoardDefinition } from '@lixiangqi/board';

/** Decode the exact URLs the scoped viewer will paint before publishing its appearance. */
export async function prepareViewerAppearance(
  definition: BoardDefinition,
  assetUrl: (path: string) => string,
  boardKey: string = boardAssets.defaultBoard,
  pieceKey: string = boardAssets.defaultPieces,
): Promise<(root: HTMLElement) => void> {
  const board = boardAssets.boards.find(theme => theme.key === boardKey);
  const family = definition.pieceFamily ?? definition.id;
  const pieces = boardAssets.pieceSets.find(theme => theme.key === pieceKey)?.variants[family];
  const artwork = board?.geometries[definition.geometry.id];
  if (!board || !pieces || !artwork) throw new Error('Unknown board or piece theme');
  const assets: Record<string, string> = {
    '---board-image': artwork,
    [`---board-image-${definition.geometry.id}`]: artwork,
    '--xiangqi-rest-shadow-image': boardAssets.shadows.rest,
    '--xiangqi-airborne-shadow-image': boardAssets.shadows.airborne,
  };
  for (const [side, path] of Object.entries(pieces.back)) assets[`--board-piece-back-${side}`] = path;
  const prefix = family === 'xiangqi' ? '---' : `---${family}-`;
  for (const [side, roles] of Object.entries(pieces.faces))
    for (const [role, path] of Object.entries(roles))
      if (role in definition.roles) assets[`${prefix}${side}-${role}`] = path;
  const cssUrl = (path: string) => `url("${assetUrl(path).replaceAll('"', '%22')}")`;
  const entries = Object.entries(assets).map(([key, path]) => [key, cssUrl(path)] as const);
  const images = entries.map(([, value]) => value);
  if (definition.coordinateImage) images.push(cssUrl(definition.coordinateImage));
  await site.pieceImages.preload(images);

  return root => {
    for (const [key, value] of entries) root.style.setProperty(key, value);
    root.style.setProperty('---cg-ccw', board.coordinateLight);
    root.style.setProperty('---cg-ccb', board.coordinateDark);
    for (const name of ['opacity', 'brightness', 'contrast', 'saturation'])
      root.style.setProperty(`---board-${name}`, '100');
    root.style.setProperty('---board-hue', '0');
    root.dataset.board = boardKey;
    root.dataset.pieceSet = pieceKey;
    root.classList.add('board-assets-ready');
  };
}
