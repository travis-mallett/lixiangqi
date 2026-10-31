import { initMiniGame, updateMiniGame } from 'lib/view';

function resize() {
  const el = document.querySelector('#featured-game') as HTMLElement;
  const player = el.querySelector<HTMLElement>('.mini-game__player');
  el.style.maxWidth = '';
  if (player && el.offsetHeight > window.innerHeight)
    el.style.maxWidth = Math.max(0, window.innerHeight - player.offsetHeight * 2) + 'px';
}

window.onload = () => {
  const findGame = () => document.querySelector<HTMLElement>('.mini-game');
  const setup = () => {
    const game = findGame();
    if (game) initMiniGame(game);
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
