import type { BoardView } from '@lixiangqi/board';
import { attributesModule, classModule, init, type VNode } from 'snabbdom';

import { createXiangqiBoard, websiteBoardPresentation, makeBoardResizable } from 'lib/board';
import { pubsub } from 'lib/pubsub';
import type { MoveTimeLimitConfig } from 'lib/setup/interfaces';
import { formatMoveTime } from 'lib/setup/timeControl';
import { wsConnect, wsSetActivity } from 'lib/socket';
import { storage } from 'lib/storage';
import { trafficActivity, trafficAttemptId, trafficNavigate, trackTraffic } from 'lib/traffic';
import { bind, hl, initMiniBoardWith, onInsert } from 'lib/view';
import { form, json as xhrJson } from 'lib/xhr';

const patch = init([classModule, attributesModule]);
const EMPTY_XIANGQI_FEN = '9/9/9/9/9/9/9/9/9/9 w - - 0 1';

interface MatchmakingPool {
  id: string;
  lim: number;
  inc: number;
  ranked: boolean;
  variant: 'xiangqi' | 'jieqi' | 'minixiangqi' | 'manchu' | 'threeKingdoms';
  moveTime?: MoveTimeLimitConfig;
}

interface MatchmakingOpts {
  pool: MatchmakingPool;
  userId?: UserId;
  username?: string;
}

interface RoundBootstrap {
  html: string;
  options: unknown;
  title: string;
  url: string;
}

interface PairingRedirect {
  id: string;
  url: string;
  cookie?: Cookie;
}

type Phase = 'ready' | 'matching' | 'handoff';

export function initModule(opts: MatchmakingOpts): void {
  new MatchmakingPage(opts);
}

class MatchmakingPage {
  private board?: BoardView;
  private error?: string;
  private phase: Phase = 'ready';
  private vnode: VNode;
  private readonly session: PoolMatchmakingSession;

  constructor(private readonly opts: MatchmakingOpts) {
    trackTraffic('room.entered', { pool: opts.pool.id });
    trafficActivity('matchmaking.room', undefined, { pool: opts.pool.id });
    const element = document.querySelector('.round__app') as HTMLElement;
    element.replaceChildren();
    this.vnode = patch(element, this.view());
    this.session = new PoolMatchmakingSession(
      opts.pool,
      !!opts.userId,
      pairing => void this.handoff(pairing),
      error => {
        this.error = error;
        if (this.phase === 'matching') {
          this.phase = 'ready';
        }
        this.redraw();
      },
    );
  }

  private readonly redraw = () => {
    this.vnode = patch(this.vnode, this.view());
  };

  private readonly start = () => {
    if (this.phase !== 'ready') return;
    this.phase = 'matching';
    this.error = undefined;
    wsSetActivity(
      this.opts.pool.id,
      this.opts.pool.variant !== 'xiangqi' || this.opts.pool.lim === 15 ? undefined : 'other',
    );
    this.redraw();
    void this.session.start();
  };

  private readonly cancelAndLeave = async () => {
    const gameUrl = await this.session.cancel();
    wsSetActivity();
    site.redirect(gameUrl ?? '/');
  };

  private async handoff(pairing: PairingRedirect): Promise<void> {
    if (this.phase !== 'matching') return;
    this.phase = 'handoff';
    this.redraw();
    applyPairingCookie(pairing.cookie);

    try {
      const bootstrap = await xhrJson<RoundBootstrap>(`/round/bootstrap/${pairing.id}`);
      this.session.complete();

      const mainWrap = document.getElementById('main-wrap');
      if (!mainWrap) throw new Error('Round page container is missing');
      this.board?.destroy();
      this.board = undefined;
      mainWrap.innerHTML = bootstrap.html;
      history.replaceState(null, '', bootstrap.url);
      document.title = bootstrap.title;
      await site.asset.loadEsm('round', { init: bootstrap.options });
      trackTraffic('round.ready', { pool: this.opts.pool.id }, {}, this.session.attempt);
      trafficActivity('game.play');
      trafficNavigate('Round.player');
      pubsub.emit('content-loaded', mainWrap);
    } catch (error) {
      trackTraffic('round.failed', { pool: this.opts.pool.id, error: 'handoff' }, {}, this.session.attempt);
      console.warn('Seamless round handoff failed', error);
      site.redirect(pairing, true);
    }
  }

  private readonly view = () =>
    hl(
      'div.round__app.variant-standard.round__app--matchmaking',
      {
        class: { 'round__app--three-players': this.opts.pool.variant === 'threeKingdoms' },
      },
      [
        hl(
          'div.round__app__board.round__matchmaking-board',
          {
            class: {
              'main-board': this.opts.pool.variant !== 'threeKingdoms',
              xiangqi9x10: this.opts.pool.variant !== 'threeKingdoms',
            },
          },
          [
            this.opts.pool.variant === 'threeKingdoms'
              ? hl('div.round__matchmaking-three-board', {
                  hook: onInsert(element => {
                    const board = (this.board = createXiangqiBoard(
                      element,
                      { board: 'threeKingdoms', active: 'red', pieces: new Map() },
                      websiteBoardPresentation({}, 'replay', 'red'),
                    ));
                    makeBoardResizable(board);
                    window.addEventListener('pagehide', () => this.board?.destroy(), { once: true });
                  }),
                })
              : hl('div.cg-wrap.is2d.xiangqi9x10', {
                  attrs: { 'aria-label': i18n.site.xiangqiBoardReady },
                  hook: onInsert(element =>
                    initMiniBoardWith(element, {
                      fen:
                        this.opts.pool.variant === 'minixiangqi'
                          ? '7/7/7/7/7/7/7 w - - 0 1'
                          : EMPTY_XIANGQI_FEN,
                      orientation: 'red',
                      coordinates: true,
                    }),
                  ),
                }),
            this.phase === 'ready' ? this.readyPanel() : this.matchingPanel(),
          ],
        ),
        hl('div.round__matchmaking-players', [
          this.player(i18n.site.opponent),
          this.opts.pool.variant === 'threeKingdoms' && this.player(i18n.site.opponent),
          this.player(this.opts.username || i18n.site.anonymous),
        ]),
      ],
    );

  private readonly readyPanel = () =>
    hl('div.round__matchmaking-panel', [
      this.error && hl('p.error', { attrs: { role: 'alert' } }, this.error),
      hl('span.round__matchmaking-eyebrow', this.opts.pool.ranked ? i18n.site.ranked : i18n.site.casual),
      hl('h2', i18n.site.timeControls),
      hl('dl.round__matchmaking-details', [
        hl('div', [hl('dt', i18n.site.minutesPerSide), hl('dd', i18n.site.minutesShort(this.opts.pool.lim))]),
        this.opts.pool.moveTime
          ? hl('div', [hl('dt', i18n.site.timePerMove), hl('dd', formatMoveTime(this.opts.pool.moveTime))])
          : null,
      ]),
      hl(
        'button.button.button-metal.round__matchmaking-start',
        { attrs: { type: 'button' }, hook: bind('click', this.start) },
        i18n.site.startMatchmaking,
      ),
      hl(
        'button.round__matchmaking-cancel',
        { attrs: { type: 'button' }, hook: bind('click', this.cancelAndLeave) },
        i18n.site.backToHomepage,
      ),
    ]);

  private readonly matchingPanel = () =>
    hl(
      'div.round__matchmaking-status',
      {
        attrs: {
          role: 'status',
          'aria-live': 'polite',
          'aria-label':
            this.opts.pool.variant === 'threeKingdoms'
              ? i18n.threeKingdoms.searching
              : i18n.site.matchingOpponent,
        },
      },
      [
        hl(
          'span',
          this.opts.pool.variant === 'threeKingdoms'
            ? i18n.threeKingdoms.searching
            : i18n.site.matchingOpponent,
        ),
        hl('span.round__matchmaking-dots', { attrs: { 'aria-hidden': 'true' } }, '....'),
        hl(
          'button.round__matchmaking-cancel',
          { attrs: { type: 'button' }, hook: bind('click', this.cancelAndLeave) },
          i18n.site.cancel,
        ),
      ],
    );

  private readonly player = (name: string) =>
    hl('div.round__matchmaking-player', [
      hl('div.round__matchmaking-user', name),
      hl('div.round__matchmaking-clock', this.initialClockText()),
    ]);

  private readonly initialClockText = () => {
    const wholeMinutes = Math.floor(this.opts.pool.lim);
    const seconds = Math.round((this.opts.pool.lim - wholeMinutes) * 60);
    return `${wholeMinutes}:${seconds.toString().padStart(2, '0')}`;
  };
}

export class PoolMatchmakingSession {
  attempt: string = trafficAttemptId();
  private startedAt = 0;
  private active = false;
  private completed = false;
  private generation = 0;
  private connection = 0;
  private joinedConnection = -1;
  private readonly poolStorage = storage.make('lobby.pool-in');
  private readonly unlistenPoolStorage: () => void;
  private readonly socket: ReturnType<typeof wsConnect>;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private joining?: Promise<{ gameId?: string; error?: string }>;
  private cancelling?: Promise<string | undefined>;

  constructor(
    private readonly pool: MatchmakingPool,
    private readonly authenticated: boolean,
    private readonly onPaired: (pairing: PairingRedirect) => void,
    private readonly onCancelled: (error?: string) => void,
  ) {
    wsSetActivity(
      this.pool.id,
      this.pool.variant !== 'xiangqi' || this.pool.lim === 15 ? undefined : 'other',
    );
    this.socket = wsConnect('/lobby/socket/v5', false, {
      options: { reloadOnResume: false },
      events: {
        redirect: (pairing: PairingRedirect) => {
          if (!this.active) return;
          this.active = false;
          this.onPaired(pairing);
          return true;
        },
      },
    });
    this.unlistenPoolStorage = this.poolStorage.listen(
      () =>
        void this.cancel().then(url => {
          if (url) site.redirect(url);
        }),
    );
    pubsub.on('socket.open', this.onSocketOpen);
    window.addEventListener('beforeunload', this.cancelOnUnload);
  }

  async start(): Promise<void> {
    if (this.active || this.completed || this.cancelling) return;
    this.attempt = trafficAttemptId();
    this.startedAt = performance.now();
    trafficActivity('matchmaking.search', this.attempt, { pool: this.pool.id });
    trackTraffic('search.clicked', { pool: this.pool.id }, {}, this.attempt);
    this.active = true;
    const generation = ++this.generation;
    this.poolStorage.fire();
    await pubsub.after('socket.hasConnected');
    if (!this.isCurrent(generation)) return;

    if (this.pool.variant === 'threeKingdoms') void this.pollThreePlayers(generation);
    else if (this.authenticated) this.joinAuthenticatedPool();
    else {
      try {
        await xhrJson('/setup/hook/' + site.sri, {
          method: 'POST',
          body: form({
            variant: 1,
            timeMode: 1,
            mode: 0,
            time: this.pool.lim,
            increment: this.pool.inc,
            'moveTime.seconds': this.pool.moveTime?.seconds,
            'moveTime.firstMoves': this.pool.moveTime?.first?.moves,
            'moveTime.firstSeconds': this.pool.moveTime?.first?.seconds,
            days: 1,
            color: 'random',
            trafficAttempt: this.attempt,
          }),
        });
        if (!this.isCurrent(generation)) this.socket.send('cancel', undefined);
      } catch (error) {
        trackTraffic('search.failed', { pool: this.pool.id, error: 'join' }, {}, this.attempt);
        if (this.isCurrent(generation)) {
          this.active = false;
          this.onCancelled();
        }
        console.warn('Could not enter the Xiangqi matchmaking pool', error);
      }
    }
  }

  cancel = async (): Promise<string | undefined> => {
    if (this.cancelling) return this.cancelling;
    if (!this.active || this.completed) return undefined;
    trackTraffic(
      'search.cancelled',
      { pool: this.pool.id },
      { durationMs: Math.round(performance.now() - this.startedAt) },
      this.attempt,
    );
    trafficActivity('matchmaking.room', undefined, { pool: this.pool.id });
    this.active = false;
    ++this.generation;
    wsSetActivity();
    clearTimeout(this.pollTimer);
    if (this.pool.variant === 'threeKingdoms') {
      this.cancelling = (async () => {
        // Order leave after an in-flight join so a cancelled search cannot re-enter the queue.
        await this.joining?.catch(() => undefined);
        return this.leaveThreePlayers();
      })();
      try {
        return await this.cancelling;
      } finally {
        this.cancelling = undefined;
        this.onCancelled();
      }
    }
    if (this.authenticated) this.socket.send('poolOut', this.pool.id);
    else this.socket.send('cancel', undefined);
    this.joinedConnection = -1;
    this.onCancelled();
    return undefined;
  };

  complete(): void {
    this.completed = true;
    this.active = false;
    ++this.generation;
    clearTimeout(this.pollTimer);
    pubsub.off('socket.open', this.onSocketOpen);
    this.unlistenPoolStorage();
    window.removeEventListener('beforeunload', this.cancelOnUnload);
    wsSetActivity();
  }

  private isCurrent(generation: number): boolean {
    return this.active && !this.completed && generation === this.generation;
  }

  private readonly joinAuthenticatedPool = () => {
    if (this.joinedConnection === this.connection) return;
    this.joinedConnection = this.connection;
    this.socket.send('poolIn', { id: this.pool.id, attempt: this.attempt }, {}, true);
  };

  private readonly onSocketOpen = () => {
    ++this.connection;
    if (this.active && this.authenticated && this.pool.variant !== 'threeKingdoms')
      this.joinAuthenticatedPool();
  };

  private async pollThreePlayers(generation: number): Promise<void> {
    try {
      const result = await (this.joining = xhrJson<{ gameId?: string; error?: string }>(
        '/api/three-kingdoms/pool',
        {
          method: 'POST',
        },
      ));
      if (result.error) throw new Error(result.error);
      if (!this.isCurrent(generation)) return;
      if (result.gameId) {
        this.onPaired({ id: result.gameId, url: `/three-kingdoms/game/${result.gameId}` });
        return;
      }
      this.pollTimer = setTimeout(() => void this.pollThreePlayers(generation), 4000);
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      const url = await this.cancel();
      if (url) site.redirect(url);
      const translated =
        error instanceof Error && (i18n.threeKingdoms as unknown as Record<string, unknown>)[error.message];
      this.onCancelled(typeof translated === 'string' ? translated : i18n.threeKingdoms.error);
      console.warn('Could not enter the matchmaking pool', error);
    }
  }

  private async leaveThreePlayers(): Promise<string | undefined> {
    try {
      const response = await fetch('/api/three-kingdoms/pool', {
        method: 'DELETE',
        keepalive: true,
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const result = await response.json();
      if (result.gameId) return `/three-kingdoms/game/${result.gameId}`;
    } catch {
      /* The server expires disconnected leases. */
    }
    return undefined;
  }

  private readonly cancelOnUnload = () => {
    if (this.active) void this.cancel();
  };
}

function applyPairingCookie(cookie?: Cookie): void {
  if (!cookie) return;
  document.cookie = [
    `${encodeURIComponent(cookie.name)}=${cookie.value}`,
    `max-age=${cookie.maxAge}`,
    'path=/',
    `domain=${location.hostname}`,
  ].join('; ');
}
