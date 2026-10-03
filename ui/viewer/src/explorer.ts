import { ExplorerCtrl, type ExplorerGame } from '@lixiangqi/explorer';

import { requestXiangqi } from 'lib/game/xiangqiApi';
import type { RulesState } from 'lib/game/xiangqiNotation';
import { completeNode } from 'lib/tree/node';

import { viewerNode, type ViewerNode } from './model';
import type { GameViewer } from './viewer';

/** The same explorer used by analysis, player, and event pages; embeds opt out of preference storage. */
export function attachExplorer(
  viewer: GameViewer,
  endpoint: string,
  label: string,
): (node: ViewerNode) => void {
  let current: ViewerNode;
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
        { initialFen: initial.fen, moves, move, ruleset: initial.node.ruleset },
        signal,
      );
      if (signal.aborted || before !== current) return;
      const native = completeNode(
        {
          uci: move,
          notation: result.notation,
          chineseNotation: result.chineseNotation,
          state: result,
          fen: result.fen,
          ply: result.ply,
          children: [],
        },
        before.node.path,
      );
      before.node.children.push(native);
      const node = viewerNode(native, initial.ply, {}, before);
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
    let root = node;
    const moves: string[] = [];
    while (root.parent) {
      moves.unshift(root.move!);
      root = root.parent;
    }
    if (!root.node.ruleset) throw new Error('Viewer is missing its native ruleset');
    explorer.setPosition({ fen: node.fen, initialFen: root.fen, moves, ruleset: root.node.ruleset });
  };
}
