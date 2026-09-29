import { existsSync, readFileSync, globSync } from 'node:fs';
import { join } from 'node:path';

import { validateBoardAssets } from '../../board/src/catalog.ts';
import { supportedBoards } from '../../board/src/definitions.ts';

export function checkBoardAssets(root: string): void {
  const catalog = JSON.parse(readFileSync(join(root, 'ui/board/src/catalog.json'), 'utf8'));
  validateBoardAssets(catalog, supportedBoards, path => existsSync(join(root, 'public', path)));
  for (const path of globSync('ui/*/src/**/*.ts', { cwd: root })) {
    const normalized = path.replaceAll('\\', '/');
    if (normalized.startsWith('ui/board/')) continue;
    const source = readFileSync(join(root, path), 'utf8');
    if (
      /from\s+['"]chessgroundx(?:[/'"])/.test(source) ||
      /from\s+['"][^'"]*board\/src\/renderer/.test(source)
    )
      throw new Error(`${normalized}: import the public @lixiangqi/board API`);
  }
}
