import catalog from './catalog.json' with { type: 'json' };
import type { BoardDefinition } from './types';

export interface BoardAssetCatalog {
  version: number;
  defaultBoard: string;
  defaultPieces: string;
  boards: Array<{
    key: string;
    name: string;
    coordinateLight: string;
    coordinateDark: string;
    matchingPieceSet: string;
    geometries: Record<string, string>;
  }>;
  pieceSets: Array<{
    key: string;
    name: string;
    category: string;
    variants: Record<string, { back: string; faces: Record<string, Record<string, string>> }>;
  }>;
  effects: Record<string, { path: string; duration: number }>;
  shadows: { rest: string; airborne: string };
  sounds: {
    defaultSet: string;
    files: Record<string, string>;
    checkmateEffect: { path: string; volume: number };
  };
}

/** Shared by the asset build, server preference catalog, and standalone viewers. */
export const boardAssets: BoardAssetCatalog = catalog;

/** A theme is accepted only when it covers every supported board and visible piece. */
export function validateBoardAssets(
  assets: BoardAssetCatalog,
  definitions: readonly BoardDefinition[],
  exists: (path: string) => boolean,
): void {
  const fail = (message: string): never => {
    throw new Error(`Board assets: ${message}`);
  };
  const file = (path: string | undefined) => {
    if (
      !path ||
      !/^[a-zA-Z0-9_./-]+$/.test(path) ||
      path.startsWith('/') ||
      path.split('/').includes('..') ||
      !exists(path)
    )
      fail(`missing or invalid asset ${path}`);
  };
  for (const group of [assets.boards, assets.pieceSets]) {
    if (new Set(group.map(item => item.key)).size !== group.length) fail('duplicate theme key');
    if (group.some(item => !/^[a-z0-9-]+$/.test(item.key))) fail('invalid theme key');
  }
  if (
    !assets.boards.some(board => board.key === assets.defaultBoard) ||
    !assets.pieceSets.some(pieces => pieces.key === assets.defaultPieces)
  )
    fail('missing default theme');
  for (const board of assets.boards) {
    if (!assets.pieceSets.some(pieces => pieces.key === board.matchingPieceSet))
      fail(`unknown matching pieces for ${board.key}`);
    for (const definition of definitions) file(board.geometries[definition.geometry.id]);
  }
  for (const collection of assets.pieceSets)
    for (const definition of definitions) {
      const pieces = collection.variants[definition.id];
      if (!pieces) fail(`${collection.key} does not cover ${definition.id}`);
      file(pieces.back);
      for (const participant of definition.participants)
        for (const role of Object.keys(definition.roles)) file(pieces.faces[participant]?.[role]);
    }
  for (const name of ['capture', 'check', 'checkmate']) {
    const effect = assets.effects[name];
    file(effect?.path);
    if (!effect || !Number.isFinite(effect.duration) || effect.duration <= 0)
      fail(`invalid ${name} duration`);
  }
  Object.values(assets.shadows).forEach(file);
  for (const name of ['move', 'capture', 'check', 'checkmate'])
    file(`sound/${assets.sounds.defaultSet}/${assets.sounds.files[name]}`);
  file(assets.sounds.checkmateEffect.path);
  if (!(assets.sounds.checkmateEffect.volume >= 0 && assets.sounds.checkmateEffect.volume <= 1))
    fail('invalid sound volume');
}
