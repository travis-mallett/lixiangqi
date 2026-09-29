import { ExplorerCtrl, type ExplorerGame } from '@lixiangqi/explorer';

import { requestXiangqi } from 'lib/game/xiangqiApi';
import type { RulesState } from 'lib/game/xiangqiNotation';

import { importedViewerTree, type ViewerNode } from './model';
import type { GameViewer } from './viewer';

/** The same explorer used by analysis, player, and event pages; embeds opt out of preference storage. */
export function attachExplorer(
  viewer: GameViewer,
  endpoint: string,
  label: string,
): (node: ViewerNode) => void {
  let current: ViewerNode;
  let sequence = 0;
  let pending: AbortController | undefined;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = label;
  const root = document.createElement('div');
  root.className = 'explorer-box';
  viewer.element.append(toggle, root);
  const explorer = new ExplorerCtrl(
    root,
    toggle,
    move => void play(move),
    game => openGame(game),
    endpoint,
    { persistPreferences: false, initiallyEnabled: false },
  );
  viewer.board.onDestroy(() => {
    pending?.abort();
    explorer.destroy();
    toggle.remove();
    root.remove();
  });
  async function play(move: string) {
    const before = current;
    const child = before.children.find(node => node.move === move);
    if (child) {
      viewer.go(child);
      return;
    }
    pending?.abort();
    pending = new AbortController();
    const signal = pending.signal;
    const moves: string[] = [];
    let initial = before;
    while (initial.parent) {
      moves.unshift(initial.move!);
      initial = initial.parent;
    }
    try {
      const result = await requestXiangqi<RulesState & { notation: string; chineseNotation: string }>(
        '/api/analysis/move',
        { initialFen: initial.fen, moves, move },
        signal,
      );
      if (signal.aborted || before !== current) return;
      const node = importedViewerTree({ initialFen: result.fen, state: result, children: [] });
      node.id = `explorer-${++sequence}`;
      node.move = move;
      node.label = result.notation;
      node.parent = before;
      const match = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(move)!;
      node.position = { ...node.position, lastMove: [match[1], match[2]] };
      before.children.push(node);
      viewer.go(node);
    } catch (error) {
      if (!signal.aborted) root.textContent = String(error);
    }
  }
  function openGame(game: ExplorerGame) {
    const url = new URL('/analysis', location.origin);
    url.searchParams.set('game', game.id);
    window.open(url.href, '_blank', 'noopener');
  }
  return node => {
    current = node;
    pending?.abort();
    explorer.setPosition({ fen: node.fen });
  };
}
