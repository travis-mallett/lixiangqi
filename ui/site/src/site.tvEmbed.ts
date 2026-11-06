import { embedAssetUrl, sizeEmbedToContent } from 'lib/embed';
import { fitEmbed } from 'lib/fitEmbed';
import { initMiniGame, updateMiniGame } from 'lib/view';

let contentSized = false;
function resize() {
  if (contentSized) return;
  const el = document.querySelector('#featured-game') as HTMLElement;
  fitEmbed(el);
}

window.onload = () => {
  contentSized = sizeEmbedToContent(document.getElementById('featured-game')!);
  const findGame = () => document.querySelector<HTMLElement>('.mini-game');
  const setup = () => {
    const game = findGame();
    if (game) initMiniGame(game, { assetUrl: embedAssetUrl });
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
        }
      },
      false,
    );
  resize();
  window.addEventListener('resize', resize);
};
