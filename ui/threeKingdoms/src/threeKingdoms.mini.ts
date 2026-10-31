import type { BoardView } from '@lixiangqi/board';

import { createXiangqiBoard, websiteBoardPresentation } from 'lib/board';
import { pubsub } from 'lib/pubsub';

import { position } from './board';
import { loadRules } from './runtime';

let initialized = false;
const boards = new Map<HTMLElement, { view: BoardView; encoded: string }>();

export function initModule(): void {
  if (initialized) return;
  initialized = true;
  const render = async (root: HTMLElement = document.body) => {
    for (const [element, board] of boards)
      if (!element.isConnected) {
        board.view.destroy();
        boards.delete(element);
      }
    const elements = [...root.querySelectorAll<HTMLElement>('[data-three-kingdoms-position]')].filter(
      e => boards.get(e)?.encoded !== e.dataset.threeKingdomsPosition,
    );
    if (!elements.length) return;
    const rules = await loadRules();
    for (const element of elements) {
      const encoded = element.dataset.threeKingdomsPosition!;
      const previous = boards.get(element);
      if (previous?.encoded === encoded) continue;
      const state = position(rules.inspect(encoded));
      if (previous) {
        previous.view.display(state, { kind: 'jump' });
        previous.encoded = encoded;
        continue;
      }
      const board = createXiangqiBoard(element, state, websiteBoardPresentation({}, 'thumbnail', 'red'));
      board.setInteraction({ mode: 'display' });
      boards.set(element, { view: board, encoded });
    }
  };
  pubsub.on('content-loaded', render);
  void render();
}
