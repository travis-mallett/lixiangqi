import { createBoard, boardPresentation, threeKingdoms, type BoardView } from '@lixiangqi/board';

import { position } from './board';
import { loadRules } from './runtime';
import type { Game } from './types';

/** One shared TV feed supplies both selection changes and moves to the lightweight embed. */
async function initModule(): Promise<void> {
  const root = document.getElementById('three-kingdoms-embed') as HTMLAnchorElement;
  // Minimal embeds load without site.ts. Resolve assets from the server's embed metadata.
  const assetUrl = (path: string) =>
    `${document.body.dataset.assetUrl || ''}/assets/_${document.body.dataset.assetVersion}/${path}`;
  const rules = await loadRules(assetUrl('three-kingdoms-engine/main.js'));
  const element = document.createElement('div');
  const players = document.createElement('div');
  players.className = 'three-kingdoms-embed__players';
  let board: BoardView | undefined;
  const stream = new EventSource('/api/three-kingdoms/tv/stream');
  stream.onmessage = event => {
    const game = JSON.parse(event.data) as Game;
    if (!game.position) return;
    root.href = `/three-kingdoms/game/${game.id}`;
    if (!board) {
      root.replaceChildren(element, players);
      board = createBoard(element, {
        definition: threeKingdoms,
        position: position(rules.inspect(game.position)),
        presentation: boardPresentation('preview', 'red'),
        interaction: { mode: 'display' },
        services: { assetUrl },
      });
      root.style.setProperty('--board-aspect-ratio', element.style.getPropertyValue('--board-aspect-ratio'));
    } else board.display(position(rules.inspect(game.position)), { kind: 'jump' });
    players.textContent = game.seats
      .map(s => s.user?.name ?? (s.guest ? root.dataset.guestLabel : root.dataset.computerLabel))
      .join(' · ');
  };
  window.addEventListener(
    'pagehide',
    () => {
      stream.close();
      board?.destroy();
    },
    { once: true },
  );
}

window.addEventListener('load', () => void initModule(), { once: true });
