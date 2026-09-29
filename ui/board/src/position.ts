import { rendererKey } from './renderer/coordinates';
import type { BoardDefinition, BoardPosition, VisiblePiece } from './types';

/** Visible position only; move counters and rule history belong to the rules layer. */
export function positionToFen(position: BoardPosition, definition: BoardDefinition): string {
  const { columns, rows } = definition.geometry;
  const active = definition.participants.indexOf(position.active);
  if (active !== 0 && active !== 1) throw new Error(`Unknown participant: ${position.active}`);
  for (const location of position.pieces.keys()) rendererKey(location, definition.geometry);
  const placement = Array.from({ length: rows }, (_, index) => {
    let result = '',
      empty = 0;
    for (let file = 0; file < columns; file++) {
      const piece = position.pieces.get(`${String.fromCharCode(97 + file)}${rows - index}`);
      if (!piece) {
        empty++;
        continue;
      }
      if (empty) result += String(empty);
      empty = 0;
      if (piece.face === 'down') result += '*';
      else {
        const letter = definition.roles[piece.role];
        const participant = definition.participants.indexOf(piece.participant);
        if (!letter || !/^[a-z]$/.test(letter)) throw new Error(`Unknown piece role: ${piece.role}`);
        if (participant !== 0 && participant !== 1)
          throw new Error(`Unknown participant: ${piece.participant}`);
        result += participant === 0 ? letter.toUpperCase() : letter;
      }
    }
    return result + (empty ? String(empty) : '');
  }).join('/');
  return `${placement} ${active === 0 ? 'w' : 'b'}`;
}

export function coordinateMove(value: string): readonly [string, string] {
  const match = /^([a-p](?:1[0-6]|[1-9]))([a-p](?:1[0-6]|[1-9]))$/.exec(value);
  if (!match) throw new Error(`Invalid coordinate move: ${value}`);
  return [match[1], match[2]];
}

export function moveDestinations(moves: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const destinations = new Map<string, string[]>();
  for (const move of moves) {
    const [from, to] = coordinateMove(move);
    const current = destinations.get(from);
    if (current) current.push(to);
    else destinations.set(from, [to]);
  }
  return destinations;
}

/** Apply an already validated recorded move for presentation; this does not establish legality. */
export function recordedPosition(position: BoardPosition, move: string, active: string): BoardPosition {
  const [from, to] = coordinateMove(move);
  const piece = position.pieces.get(from);
  if (!piece) throw new Error(`No recorded piece at ${from}`);
  const pieces = new Map(position.pieces);
  pieces.delete(from);
  pieces.set(to, piece);
  return { pieces, active, lastMove: [from, to] };
}

/** Codec for rectangular visible positions. Hidden identities are never accepted here. */
export function positionFromFen(fen: string, definition: BoardDefinition): BoardPosition {
  const [placement, turn = 'w'] = fen.trim().split(/\s+/);
  const ranks = placement.split('/');
  if (ranks.length !== definition.geometry.rows || !['w', 'b'].includes(turn))
    throw new Error('Invalid board position');
  const pieces = new Map<string, VisiblePiece>();
  ranks.forEach((rank, index) => {
    let file = 0;
    for (const token of rank.match(/\d+|./g) ?? []) {
      if (/^\d+$/.test(token)) {
        if (Number(token) < 1) throw new Error('Invalid empty-file count');
        file += Number(token);
      } else {
        const role = Object.keys(definition.roles).find(
          role => definition.roles[role] === token.toLowerCase(),
        );
        if (!role && token !== '*') throw new Error(`Invalid piece: ${token}`);
        pieces.set(
          `${String.fromCharCode(97 + file)}${definition.geometry.rows - index}`,
          role
            ? {
                face: 'up',
                participant: definition.participants[token === token.toUpperCase() ? 0 : 1],
                role,
              }
            : { face: 'down', back: 'default' },
        );
        file++;
      }
    }
    if (file !== definition.geometry.columns) throw new Error('Invalid board width');
  });
  return { pieces, active: definition.participants[turn === 'w' ? 0 : 1] };
}
