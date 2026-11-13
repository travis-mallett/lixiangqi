import { boardPresentation, type BoardView } from '@lixiangqi/board';

import { createXiangqiBoard } from 'lib/board';
import { embedAssetUrl as assetUrl, sizeEmbedToContent } from 'lib/embed';

import { position } from './board';
import { loadRules } from './runtime';
import type { Game } from './types';

/** One shared TV feed supplies both selection changes and moves to the lightweight embed. */
async function initModule(): Promise<void> {
  const root = document.getElementById('three-kingdoms-embed') as HTMLAnchorElement;
  sizeEmbedToContent(root);
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
      board = createXiangqiBoard(
        element,
        position(rules.inspect(game.position)),
        boardPresentation('preview', 'red'),
        { mode: 'display' },
        { assetUrl },
      );
      root.style.setProperty('--board-aspect-ratio', element.style.getPropertyValue('--board-aspect-ratio'));
    } else board.display(position(rules.inspect(game.position)), { kind: 'jump' });
    players.replaceChildren(
      ...game.seats.map(seat => {
        const name = document.createElement('span');
        name.className = `three-kingdoms-embed__player three-kingdoms-embed__player--${seat.color}`;
        name.textContent =
          seat.user?.name ?? (seat.guest ? root.dataset.guestLabel : root.dataset.computerLabel)!;
        name.title = name.textContent;
        return name;
      }),
    );
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
