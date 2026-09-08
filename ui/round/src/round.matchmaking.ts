import { attributesModule, classModule, init, type VNode } from 'snabbdom';

import { pubsub } from 'lib/pubsub';
import type { MoveTimeLimitConfig } from 'lib/setup/interfaces';
import { formatMoveTime } from 'lib/setup/timeControl';
import { wsConnect } from 'lib/socket';
import { storage } from 'lib/storage';
import { bind, hl, initMiniBoardWith, onInsert } from 'lib/view';
import { form, json as xhrJson } from 'lib/xhr';

const patch = init([classModule, attributesModule]);
const EMPTY_XIANGQI_FEN = '9/9/9/9/9/9/9/9/9/9 w - - 0 1';

interface MatchmakingPool {
  id: string;
  lim: number;
  inc: number;
  ranked: boolean;
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
  private phase: Phase = 'ready';
  private vnode: VNode;
  private readonly session: PoolMatchmakingSession;

  constructor(private readonly opts: MatchmakingOpts) {
    const element = document.querySelector('.round__app') as HTMLElement;
    this.vnode = patch(element, this.view());
    this.session = new PoolMatchmakingSession(
      opts.pool,
      !!opts.userId,
      pairing => void this.handoff(pairing),
      () => {
        if (this.phase === 'matching') {
          this.phase = 'ready';
          this.redraw();
        }
      },
    );
  }

  private readonly redraw = () => {
    this.vnode = patch(this.vnode, this.view());
  };

  private readonly start = () => {
    if (this.phase !== 'ready') return;
    this.phase = 'matching';
    this.redraw();
    void this.session.start();
  };

  private readonly cancelAndLeave = () => {
    this.session.cancel();
    site.redirect('/');
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
      mainWrap.innerHTML = bootstrap.html;
      history.replaceState(null, '', bootstrap.url);
      document.title = bootstrap.title;
      await site.asset.loadEsm('round', { init: bootstrap.options });
      pubsub.emit('content-loaded', mainWrap);
    } catch (error) {
      console.warn('Seamless round handoff failed', error);
      site.redirect(pairing, true);
    }
  }

  private readonly view = () =>
    hl('div.round__app.variant-standard.round__app--matchmaking', [
      hl('div.round__app__board.main-board.xiangqi9x10.round__matchmaking-board', [
        hl('div.cg-wrap.is2d.xiangqi9x10', {
          attrs: { 'aria-label': i18n.site.xiangqiBoardReady },
          hook: onInsert(element =>
            initMiniBoardWith(element, {
              fen: EMPTY_XIANGQI_FEN,
              orientation: 'white',
              coordinates: true,
            }),
          ),
        }),
        this.phase === 'ready' ? this.readyPanel() : this.matchingPanel(),
      ]),
      hl('div.round__app__table.round__matchmaking-table'),
      hl('div.ruser.ruser-top.round__matchmaking-user', i18n.site.opponent),
      hl('div.ruser.ruser-bottom.round__matchmaking-user', this.opts.username || i18n.site.anonymous),
      this.stoppedClock('top'),
      this.stoppedClock('bottom'),
    ]);

  private readonly readyPanel = () =>
    hl('div.round__matchmaking-panel', [
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
          'aria-label': i18n.site.matchingOpponent,
        },
      },
      [
        hl('span', i18n.site.matchingOpponent),
        hl('span.round__matchmaking-dots', { attrs: { 'aria-hidden': 'true' } }, '....'),
      ],
    );

  private readonly stoppedClock = (position: 'top' | 'bottom') =>
    hl(`div.rclock.rclock-${position}.round__matchmaking-clock`, this.initialClockText());

  private readonly initialClockText = () => {
    const wholeMinutes = Math.floor(this.opts.pool.lim);
    const seconds = Math.round((this.opts.pool.lim - wholeMinutes) * 60);
    return `${wholeMinutes}:${seconds.toString().padStart(2, '0')}`;
  };
}

class PoolMatchmakingSession {
  private active = false;
  private completed = false;
  private generation = 0;
  private connection = 0;
  private joinedConnection = -1;
  private readonly poolStorage = storage.make('lobby.pool-in');
  private readonly unlistenPoolStorage: () => void;
  private readonly socket: ReturnType<typeof wsConnect>;

  constructor(
    private readonly pool: MatchmakingPool,
    private readonly authenticated: boolean,
    private readonly onPaired: (pairing: PairingRedirect) => void,
    private readonly onCancelled: () => void,
  ) {
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
    this.unlistenPoolStorage = this.poolStorage.listen(() => this.cancel());
    pubsub.on('socket.open', this.onSocketOpen);
    window.addEventListener('beforeunload', this.cancelOnUnload);
  }

  async start(): Promise<void> {
    if (this.active || this.completed) return;
    this.active = true;
    const generation = ++this.generation;
    this.poolStorage.fire();
    await pubsub.after('socket.hasConnected');
    if (!this.isCurrent(generation)) return;

    if (this.authenticated) this.joinAuthenticatedPool();
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
          }),
        });
        if (!this.isCurrent(generation)) this.socket.send('cancel', undefined);
      } catch (error) {
        if (this.isCurrent(generation)) {
          this.active = false;
          this.onCancelled();
        }
        console.warn('Could not enter the Xiangqi matchmaking pool', error);
      }
    }
  }

  cancel = (): void => {
    if (!this.active || this.completed) return;
    this.active = false;
    ++this.generation;
    if (this.authenticated) this.socket.send('poolOut', this.pool.id);
    else this.socket.send('cancel', undefined);
    this.onCancelled();
  };

  complete(): void {
    this.completed = true;
    this.active = false;
    ++this.generation;
    pubsub.off('socket.open', this.onSocketOpen);
    this.unlistenPoolStorage();
    window.removeEventListener('beforeunload', this.cancelOnUnload);
  }

  private isCurrent(generation: number): boolean {
    return this.active && !this.completed && generation === this.generation;
  }

  private readonly joinAuthenticatedPool = () => {
    if (this.joinedConnection === this.connection) return;
    this.joinedConnection = this.connection;
    this.socket.send('poolIn', { id: this.pool.id }, {}, true);
  };

  private readonly onSocketOpen = () => {
    ++this.connection;
    if (this.active && this.authenticated) this.joinAuthenticatedPool();
  };

  private readonly cancelOnUnload = () => {
    if (this.active) this.cancel();
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
