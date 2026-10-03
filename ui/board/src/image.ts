import { boardAssets } from './catalog';
import type { BoardDefinition, BoardMark, BoardPosition, Participant } from './types';

export interface BoardImageOptions {
  definition: BoardDefinition;
  position: BoardPosition;
  perspective: Participant;
  theme?: string;
  pieceSet?: string;
  marks?: readonly BoardMark[];
  labels?: Readonly<Record<Participant, string>>;
  clocks?: Readonly<Record<Participant, number>>;
  glyph?: string;
}

const escapeXml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  );

/** Shared static board composition for downloads, thumbnails, and animated frames. */
export function boardImageSvg(options: BoardImageOptions, assetUrl: (path: string) => string): string {
  const { definition, position, perspective } = options;
  const { columns, rows, id } = definition.geometry;
  const reversed = definition.participants.indexOf(perspective);
  if (reversed !== 0 && reversed !== 1) throw new Error('Invalid image perspective');
  const board = boardAssets.boards.find(b => b.key === (options.theme ?? boardAssets.defaultBoard));
  const pieces = boardAssets.pieceSets.find(p => p.key === (options.pieceSet ?? boardAssets.defaultPieces));
  const faces = pieces?.variants[definition.id];
  if (!board?.geometries[id] || !faces) throw new Error('Unsupported board image theme');
  const band = options.labels || options.clocks ? 52 : 0;
  const width = columns * 100;
  const boardHeight = rows * 100;
  const imageHeight = boardHeight + band * 2;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${imageHeight}" viewBox="0 0 ${width} ${imageHeight}">`,
    '<rect width="100%" height="100%" fill="#f6f1e8"/>',
    `<image href="${escapeXml(assetUrl(board.geometries[id]))}" x="0" y="${band}" width="${width}" height="${boardHeight}"/>`,
  ];
  const point = (square: string): [number, number] => {
    const match = /^([a-p])([1-9]|1[0-6])$/.exec(square);
    if (!match) throw new Error(`Invalid image intersection: ${square}`);
    const file = match[1].charCodeAt(0) - 97;
    const rank = Number(match[2]);
    if (file >= columns || rank > rows) throw new Error(`Intersection outside board: ${square}`);
    return [
      (reversed ? columns - 1 - file : file) * 100 + 50,
      (reversed ? rank - 1 : rows - rank) * 100 + 50 + band,
    ];
  };
  for (const square of position.lastMove ?? []) {
    const [x, y] = point(square);
    parts.push(
      `<rect x="${x - 48}" y="${y - 48}" width="96" height="96" rx="10" fill="#d4aa00" opacity=".3"/>`,
    );
  }
  for (const [square, piece] of position.pieces) {
    const [x, y] = point(square);
    const path = piece.face === 'down' ? faces.back : faces.faces[piece.participant]?.[piece.role];
    if (!path) throw new Error('Unknown board image piece');
    parts.push(
      `<image href="${escapeXml(assetUrl(boardAssets.shadows.rest))}" x="${x - 100}" y="${y - 100}" width="200" height="200"/>`,
    );
    parts.push(
      `<image href="${escapeXml(assetUrl(path))}" x="${x - 50}" y="${y - 50}" width="100" height="100"/>`,
    );
  }
  for (const square of position.checked ?? []) {
    const [x, y] = point(square);
    parts.push(`<circle cx="${x}" cy="${y}" r="45" fill="none" stroke="#be2626" stroke-width="8"/>`);
  }
  const brushes: Record<string, string> = {
    green: '#15781b',
    red: '#882020',
    blue: '#003088',
    yellow: '#e68f00',
  };
  for (const mark of options.marks ?? []) {
    const color = brushes[mark.brush ?? 'green'];
    if (!color) throw new Error('Unknown annotation brush');
    const [x, y] = point(mark.from);
    if (mark.to) {
      const [dx, dy] = point(mark.to);
      const length = Math.hypot(dx - x, dy - y);
      if (!length) throw new Error('An arrow needs distinct endpoints');
      const ux = (dx - x) / length;
      const uy = (dy - y) / length;
      const endX = dx - ux * 24;
      const endY = dy - uy * 24;
      parts.push(
        `<g opacity=".8"><path d="M${x} ${y}L${endX} ${endY}" stroke="${color}" stroke-width="10" fill="none"/><path d="M${dx - ux * 5} ${dy - uy * 5}L${endX - uy * 15} ${endY + ux * 15}L${endX + uy * 15} ${endY - ux * 15}Z" fill="${color}"/></g>`,
      );
    } else
      parts.push(
        `<circle cx="${x}" cy="${y}" r="43" stroke="${color}" stroke-width="8" fill="none" opacity=".8"/>`,
      );
  }
  if (options.glyph && position.lastMove) {
    const [x, y] = point(position.lastMove[1]);
    parts.push(
      `<circle cx="${x + 31}" cy="${y - 30}" r="24" fill="#f6f1e8"/><text x="${x + 31}" y="${y - 22}" text-anchor="middle" font-family="sans-serif" font-size="29" fill="#222">${escapeXml(options.glyph)}</text>`,
    );
  }
  if (band) {
    const bottom = perspective;
    const top = definition.participants[1 - reversed];
    for (const [side, y] of [
      [top, 36],
      [bottom, imageHeight - 15],
    ] as const) {
      const clock = options.clocks?.[side];
      const clockText =
        clock === undefined
          ? ''
          : `${Math.floor(clock / 6000)}:${String(Math.floor(clock / 100) % 60).padStart(2, '0')}`;
      parts.push(
        `<text x="18" y="${y}" font-family="sans-serif" font-size="28" fill="#222">${escapeXml((options.labels?.[side] ?? '').slice(0, 52))}</text>`,
      );
      parts.push(
        `<text x="${width - 18}" y="${y}" text-anchor="end" font-family="sans-serif" font-size="28" fill="#222">${clockText}</text>`,
      );
    }
  }
  return parts.join('') + '</svg>';
}
