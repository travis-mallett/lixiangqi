import { pubsub } from 'lib/pubsub';
import { wsConnect, wsPingInterval } from 'lib/socket';
import * as xhr from 'lib/xhr';

import type { LobbyOpts } from './interfaces';
import main from './main';

export function initModule(opts: LobbyOpts) {
  opts.appElement = document.createElement('div');
  opts.appElement.className = 'lobby__app';
  opts.tableElement = document.querySelector('.lobby__table') as HTMLElement;
  opts.socketSend = wsConnect('/lobby/socket/v5', false, {
    options: { reloadOnResume: true },
    receive: (t: string, d: any) => lobbyCtrl.socket.receive(t, d),
    events: {
      n(_: string, msg: any) {
        lobbyCtrl.data.counters.members = msg.d;
        lobbyCtrl.data.counters.rounds = msg.r;
        lobbyCtrl.spreadPlayersNumber?.(msg.d);
        setTimeout(() => lobbyCtrl.spreadGamesNumber?.(msg.r), wsPingInterval() / 2);
        lobbyCtrl.redraw();
      },
      reload_timeline() {
        xhr.text('/timeline').then(html => {
          $('.timeline').html(html);
          pubsub.emit('content-loaded');
        });
      },
      featured(o: { html: string }) {
        const $tv = $('.lobby__tv'),
          $game = $tv.find('.mini-game');
        if ($game.length) $game.replaceWith(o.html);
        else $tv.append(o.html);
        pubsub.emit('content-loaded');
      },
      redirect(e: RedirectTo) {
        lobbyCtrl.setRedirecting();
        lobbyCtrl.leavePool();
        site.redirect(e, true);
        return true;
      },
      fen(e: any) {
        lobbyCtrl.gameActivity(e.id);
      },
    },
  }).send;
  pubsub.after('socket.hasConnected').then(() => {
    const gameId = new URLSearchParams(location.search).get('hook_like');
    if (!gameId) return;
    const { ratingMin, ratingMax } = lobbyCtrl.setupCtrl.makeSetupStore('hook')();
    xhr.text(
      xhr.url(`/setup/hook/${site.sri}/like/${gameId}`, { deltaMin: ratingMin, deltaMax: ratingMax }),
      {
        method: 'post',
      },
    );
    lobbyCtrl.setTab('real_time');
    history.replaceState(null, '', '/');
  });

  const lobbyCtrl = main(opts);
}
