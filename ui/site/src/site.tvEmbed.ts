import { attributesModule, init, type VNode } from 'snabbdom';

import { embedAssetUrl, sizeEmbedToContent } from 'lib/embed';
import { fitEmbed } from 'lib/fitEmbed';
import { banqiRail } from 'lib/game/view/banqiRail';
import { initMiniGame, updateMiniGame } from 'lib/view';

let contentSized = false;
function captureRails(game: HTMLElement): ((fen: string) => void) | undefined {
  if (!document.body.dataset.streamUrl?.startsWith('/tv/banqi/')) return;
  const wrap = game.querySelector<HTMLElement>('.cg-wrap');
  if (!wrap) return;
  const frame = document.createElement('div');
  frame.className = 'banqi-frame';
  const board = document.createElement('div');
  board.className = 'main-board';
  const top = document.createElement('div'),
    bottom = document.createElement('div');
  const orientation = game.dataset.state?.split(',')[1] === 'black' ? 'black' : 'red';
  wrap.replaceWith(frame);
  board.append(wrap);
  frame.append(top, board, bottom);
  let upperRail: HTMLElement | VNode = top,
    lowerRail: HTMLElement | VNode = bottom;
  const patch = init([attributesModule]);
  return fen => {
    upperRail = patch(upperRail, banqiRail(fen, orientation, true, embedAssetUrl));
    lowerRail = patch(lowerRail, banqiRail(fen, orientation, false, embedAssetUrl));
  };
}
function resize() {
  if (contentSized) return;
  const el = document.querySelector('#featured-game') as HTMLElement;
  fitEmbed(el);
}

window.onload = () => {
  contentSized = sizeEmbedToContent(document.getElementById('featured-game')!);
  const findGame = () => document.querySelector<HTMLElement>('.mini-game');
  let showFen: ((fen: string) => void) | undefined;
  const setup = () => {
    const game = findGame();
    showFen = (game && captureRails(game)) || undefined;
    if (game) initMiniGame(game, { assetUrl: embedAssetUrl }, showFen);
    resize();
  };
  setup();
  if (window.EventSource)
    new EventSource(document.body.getAttribute('data-stream-url')!).addEventListener(
      'message',
      e => {
        const msg = JSON.parse(e.data);
        if (msg.t === 'featured') {
          document.getElementById('featured-game')!.innerHTML = msg.d.html;
          setup();
        } else if (msg.t === 'fen') {
          const game = findGame();
          if (game) updateMiniGame(game, msg.d);
          showFen?.(msg.d.fen);
        }
      },
      false,
    );
  resize();
  window.addEventListener('resize', resize);
};
