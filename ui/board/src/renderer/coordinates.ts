import type { Key } from 'chessgroundx/types';

import type { BoardGeometry, Location } from '../types';

export function rendererKey(location: Location, geometry: BoardGeometry): Key {
  const match = /^([a-p])([1-9]|1[0-6])$/.exec(location);
  if (!match || match[1].charCodeAt(0) - 97 >= geometry.columns || Number(match[2]) > geometry.rows)
    throw new Error(`Invalid location ${location} for ${geometry.id}`);
  return `${match[1]}${String.fromCharCode(48 + Number(match[2]))}` as Key;
}

export const boardLocation = (key: Key): Location => `${key[0]}${key.charCodeAt(1) - 48}`;
