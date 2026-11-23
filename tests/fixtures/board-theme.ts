import catalog from '../../ui/board/src/catalog.json';

/** The same CSS bindings that full pages and minimal embeds receive from the server. */
export function boardThemeCss(base = '/assets/'): string {
  const images: Record<string, string> = {
    '--xiangqi-rest-shadow-image': catalog.shadows.rest,
    '--xiangqi-airborne-shadow-image': catalog.shadows.airborne,
  };
  const board = catalog.boards.find(theme => theme.key === catalog.defaultBoard)!;
  images['---board-image'] = board.geometries['xiangqi-9x10'];
  for (const [geometry, path] of Object.entries(board.geometries))
    images[`---board-image-${geometry}`] = path;
  const pieces = catalog.pieceSets.find(theme => theme.key === catalog.defaultPieces)!;
  for (const [family, variant] of Object.entries(pieces.variants)) {
    const prefix = family === 'xiangqi' ? '' : family + '-';
    for (const [color, roles] of Object.entries(variant.faces))
      for (const [role, path] of Object.entries(roles)) images[`---${prefix}${color}-${role}`] = path;
    for (const [color, path] of Object.entries(variant.back)) images[`--board-piece-back-${color}`] = path;
  }
  return (
    ':root{' +
    Object.entries(images)
      .map(([key, path]) => `${key}:url("${base}${path}");`)
      .join('') +
    '}'
  );
}
