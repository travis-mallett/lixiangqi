import { api } from 'lib/api';
import { pubsub } from 'lib/pubsub';
import * as xhr from 'lib/xhr';

interface ReplacementResponse {
  id: string;
  html: string;
}

const getId = (el: Element) => el.getAttribute('href')?.substring(1, 9);

let isRequestPending = false;
const finishedIdQueue: string[] = [];

const requestReplacementGame = () => {
  // Make sure to only make one request at a time.
  // This avoids getting copies of the same game to replace two different finished games.
  if (isRequestPending) return;
  const oldId = finishedIdQueue.shift();
  if (!oldId) return;
  if (!document.querySelector(`.tv-current .mini-game[href^="/${oldId}"]`)) {
    requestReplacementGame();
    return;
  }
  isRequestPending = true;

  // Use requestAnimationFrame to avoid requesting games in background tabs
  requestAnimationFrame(() => {
    const main = $('main.tv-games');
    const url = new URL(main.data('rel').replace('gameId', oldId));
    main.find('.tv-current .mini-game').each((_i, el) => url.searchParams.append('exclude', getId(el)!));
    xhr
      .json(url.toString())
      .then((data: ReplacementResponse) => {
        main.find(`.tv-current .mini-game[href^="/${oldId}"]`).replaceWith(data.html);
        if (data.html.includes('mini-game__result')) api.overrides.tvGamesOnFinish(data.id);
        pubsub.emit('content-loaded');
      })
      .then(retryRequest, retryRequest);
  });
};

const retryRequest = () => {
  isRequestPending = false;
  requestReplacementGame();
};

api.overrides.tvGamesOnFinish = (id: string) => {
  if (!document.querySelector(`.tv-current .mini-game[href^="/${id}"]`)) return;
  setTimeout(() => {
    finishedIdQueue.push(id);
    requestReplacementGame();
  }, 7000); // 7000 matches the rematch wait duration in /modules/tv/main/Tv.scala
};

site.load.then(() => {
  pubsub.on('socket.in.finish', ({ id }) => api.overrides.tvGamesOnFinish(id));
  $('main.tv-games')
    .find('.tv-current .mini-game')
    .each((_i, el) => {
      if ($(el).find('.mini-game__result').length > 0) api.overrides.tvGamesOnFinish(getId(el)!);
    });

  // A quiet channel can gain games without any existing board producing a finish event.
  // Reconcile in the foreground, preserving live board instances already on screen.
  const refresh = async () => {
    if (document.hidden || isRequestPending) return;
    isRequestPending = true;
    try {
      const html = await xhr.text(window.location.href);
      const page = new DOMParser().parseFromString(html, 'text/html');
      if (page.querySelector('main.tv-single')) {
        site.reload();
        return;
      }
      const incoming = page.querySelector('.tv-current');
      const current = document.querySelector('.tv-current');
      if (!incoming || !current) return;
      const ids = new Set(Array.from(incoming.querySelectorAll('.mini-game'), getId));
      current.querySelectorAll('.mini-game').forEach(el => {
        if (!ids.has(getId(el))) el.remove();
      });
      incoming.querySelectorAll('.mini-game').forEach(el => {
        if (!Array.from(current.querySelectorAll('.mini-game')).some(old => getId(old) === getId(el)))
          current.append(el);
      });
      current.querySelector('[role="status"]')?.remove();
      if (!ids.size) {
        const empty = incoming.querySelector('[role="status"]');
        if (empty) current.append(empty);
      }
      const recent = document.querySelector('.tv-recent');
      const incomingRecent = page.querySelector('.tv-recent');
      if (recent && incomingRecent) recent.replaceChildren(...incomingRecent.childNodes);
      pubsub.emit('content-loaded');
    } catch {
      // The next foreground refresh retries a temporarily unavailable channel.
    } finally {
      retryRequest();
    }
  };
  setInterval(refresh, 30_000);
});
