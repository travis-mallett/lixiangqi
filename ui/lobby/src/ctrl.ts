import { numberFormat } from 'lib/i18n';
import * as poolRangeStorage from 'lib/poolRangeStorage';
import { pubsub } from 'lib/pubsub';
import { colors, type ColorChoice } from 'lib/setup/color';
import { wsPingInterval } from 'lib/socket';
import { storage, type LichessStorage } from 'lib/storage';

import Filter from './filter';
import * as hookRepo from './hookRepo';
import type {
  LobbyOpts,
  LobbyData,
  Tab,
  Mode,
  Sort,
  Hook,
  Pool,
  PoolMember,
  GameType,
  ForceSetupOptions,
  LobbyMe,
} from './interfaces';
import * as seekRepo from './seekRepo';
import SetupController from './setupCtrl';
import LobbySocket from './socket';
import { make as makeStores, type Stores } from './store';
import variantConfirm from './variant';
import * as xhr from './xhr';

export default class LobbyController {
  data: LobbyData;
  playban: any;
  me?: LobbyMe;
  socket: LobbySocket;
  stores: Stores;
  tab: Tab;
  mode: Mode;
  sort: Sort;
  stepHooks: Hook[] = [];
  stepping = false;
  redirecting = false;
  poolMember?: PoolMember;
  seekingPoolId?: string;
  pools: Pool[];
  homePools: Pool[];
  filter: Filter;
  setupCtrl: SetupController;

  private anonPoolRequest?: { id: string; cancelled: boolean };

  private readonly poolInStorage: LichessStorage;
  private flushHooksTimeout?: number;
  private readonly alreadyWatching: string[] = [];

  constructor(
    readonly opts: LobbyOpts,
    readonly redraw: () => void,
  ) {
    this.data = {
      ...opts.data,
      hooks: [],
      seeks: [],
      poolCounts: opts.data.poolCounts ?? {},
    };
    this.me = opts.data.me;
    this.pools = opts.pools;
    this.homePools = opts.homePools;
    this.playban = opts.playban;
    this.filter = new Filter(storage.make('lobby.filter'), this);
    this.setupCtrl = new SetupController(this);
    hookRepo.initAll(this);
    seekRepo.initAll(this);
    this.socket = new LobbySocket(opts.socketSend, this);

    this.stores = makeStores(this.me?.username.toLowerCase());
    if (this.me?.isBot) this.tab = 'now_playing';
    else {
      if (this.stores.tab.get() === 'now_playing' && this.data.nbNowPlaying === 0)
        this.stores.tab.set('pools');
      else if (this.hasOngoingRealTimeGame(false)) this.stores.tab.set('now_playing');
      this.tab = this.stores.tab.get();
    }
    this.mode = this.stores.mode.get();
    this.sort = this.me ? this.stores.sort.get() : 'time';

    const locationHash = location.hash.replace('#', '');
    if (['ai', 'friend', 'hook'].includes(locationHash)) {
      const forceOptions: ForceSetupOptions = {};
      const urlParams = new URLSearchParams(location.search);
      const friendUser = urlParams.get('user') ?? undefined;
      const variant = urlParams.get('variant');

      if (variant) forceOptions.variant = variant as VariantKey;

      if (locationHash !== 'hook' && urlParams.get('fen')) {
        forceOptions.fen = urlParams.get('fen')!;
        forceOptions.variant = 'fromPosition';
      }

      let timeMode = urlParams.get('time');
      const days = urlParams.get('days');
      const minutesPerSide = urlParams.get('minutesPerSide');
      const increment = urlParams.get('increment');
      const moveTime = urlParams.get('moveTime');

      if (!timeMode) {
        if (days) timeMode = 'correspondence';
        else if (minutesPerSide || increment) timeMode = 'realTime';
      }

      if (timeMode === 'correspondence') {
        forceOptions.timeMode = 'correspondence';
        if (days) forceOptions.days = parseInt(days);
        if (locationHash === 'hook') this.tab = 'seeks';
      } else if (timeMode === 'realTime') {
        forceOptions.timeMode = 'realTime';
        if (minutesPerSide) forceOptions.time = parseFloat(minutesPerSide);
        if (increment) forceOptions.increment = parseInt(increment);
        forceOptions.moveTime = undefined;
        if (moveTime) {
          const seconds = parseInt(moveTime);
          const firstMoves = parseInt(urlParams.get('moveTimeFirstMoves') || '');
          const firstSeconds = parseInt(urlParams.get('moveTimeFirstSeconds') || '');
          if (seconds >= 1 && seconds <= 300) {
            forceOptions.moveTime = { seconds };
            if (firstMoves >= 1 && firstMoves <= 20 && firstSeconds >= 1 && firstSeconds <= 300)
              forceOptions.moveTime.first = { moves: firstMoves, seconds: firstSeconds };
          }
        }
        if (locationHash === 'hook') this.tab = 'real_time';
      } else if (timeMode === 'unlimited') {
        if (locationHash === 'hook') this.tab = 'seeks';
        forceOptions.timeMode = 'unlimited';
        forceOptions.mode = 'casual';
      }

      if (locationHash === 'hook' || locationHash === 'friend') {
        const gameMode = urlParams.get('gameMode');
        if (gameMode === 'casual' || gameMode === 'rated') {
          forceOptions.mode = gameMode;
        }
      }

      const color = urlParams.get('color');
      if (color && colors.some(c => c.key === color)) {
        forceOptions.color = color as ColorChoice;
      }

      pubsub.after('polyfill.dialog').then(() => {
        this.setupCtrl.openModal(locationHash as Exclude<GameType, 'local'>, forceOptions, friendUser);
        redraw();
      });
      history.replaceState(null, '', '/');
    }

    this.poolInStorage = storage.make('lobby.pool-in');
    this.poolInStorage.listen(_ => {
      // when another tab joins a pool
      this.leavePool();
      redraw();
    });
    this.flushHooksSchedule();

    this.startWatching();

    if (this.playban) {
      if (this.playban.remainingSeconds < 86400)
        setTimeout(site.reload, this.playban.remainingSeconds * 1000);
    } else {
      setInterval(() => {
        if (this.poolMember) this.poolIn();
        else if (this.tab === 'real_time' && !this.data.hooks.length) this.socket.realTimeIn();
      }, 10 * 1000);
      this.joinPoolFromLocationHash();
    }

    pubsub.on('socket.open', () => {
      if (this.tab === 'real_time') {
        this.data.hooks = [];
        this.socket.realTimeIn();
      } else if (this.tab === 'pools' && this.poolMember) this.poolIn();
      else if (this.tab === 'seeks') this.fetchSeeks();
    });

    window.addEventListener('beforeunload', () => this.leavePool());
  }

  spreadPlayersNumber?: (nb: number) => void;
  spreadGamesNumber?: (nb: number) => void;
  openLobbyOverlay: () => void = () => {};
  openSetupFromLobby: (gameType: Exclude<GameType, 'local'>) => void = gameType => {
    this.setupCtrl.openModal(gameType);
    this.redraw();
  };

  poolCount = (id: string): number => this.data.poolCounts[id] ?? 0;
  isPoolSeeking = (id: string): boolean => this.poolMember?.id === id || this.seekingPoolId === id;
  hasPoolSeeking = (): boolean => !!this.poolMember || !!this.seekingPoolId;
  initNumberSpreader = (elm: HTMLAnchorElement, nbSteps: number, initialCount: number) => {
    let previous = initialCount;
    let timeouts: number[] = [];
    const display = (prev: number, cur: number, it: number) => {
      elm.textContent = numberFormat(Math.round((prev * (nbSteps - 1 - it) + cur * (it + 1)) / nbSteps));
    };
    return (nb: number) => {
      if (!nb && nb !== 0) return;
      timeouts.forEach(clearTimeout);
      timeouts = [];
      const interv = Math.abs(wsPingInterval() / nbSteps);
      const prev = previous || nb;
      previous = nb;
      for (let i = 0; i < nbSteps; i++)
        timeouts.push(setTimeout(() => display(prev, nb, i), Math.round(i * interv)));
    };
  };

  private doFlushHooks() {
    this.stepHooks = this.data.hooks.slice(0);
    if (this.tab === 'real_time') this.redraw();
  }

  flushHooks = (now: boolean) => {
    if (this.flushHooksTimeout) clearTimeout(this.flushHooksTimeout);
    if (now) this.doFlushHooks();
    else {
      this.stepping = true;
      if (this.tab === 'real_time') this.redraw();
      setTimeout(() => {
        this.stepping = false;
        this.doFlushHooks();
      }, 500);
    }
    this.flushHooksTimeout = this.flushHooksSchedule();
  };

  private readonly flushHooksSchedule = () => setTimeout(this.flushHooks, 8000);

  setTab = (tab: Tab) => {
    if (tab !== this.tab) {
      if (tab === 'seeks') this.fetchSeeks();
      else if (tab === 'real_time') this.socket.realTimeIn();
      else if (this.tab === 'real_time') {
        this.socket.realTimeOut();
        this.data.hooks = [];
      }
      this.tab = this.stores.tab.set(tab);
      this.redraw();
    }
    this.filter.open = false;
  };

  setMode = (mode: Mode) => {
    this.mode = this.stores.mode.set(mode);
    this.filter.open = false;
  };

  setSort = (sort: Sort) => {
    this.sort = this.stores.sort.set(sort);
  };

  onSetFilter = () => {
    this.flushHooks(true);
    if (this.tab !== 'real_time') this.redraw();
  };

  clickHook = async (id: string) => {
    const hook = hookRepo.find(this, id);
    if (!hook || hook.disabled || this.stepping || this.redirecting) return;
    if (hook.action === 'cancel' || (await variantConfirm(hook.variant)))
      this.socket.send(hook.action, hook.id);
  };

  clickSeek = async (id: string) => {
    const seek = seekRepo.find(this, id);
    if (!seek || this.redirecting) return;
    if (seek.action === 'cancelSeek' || (await variantConfirm(seek.variant?.key)))
      this.socket.send(seek.action, seek.id);
  };

  fetchSeeks = async () => {
    this.data.seeks = await xhr.seeks();
    seekRepo.initAll(this);
    this.redraw();
  };

  clickPool = async (id: string) => {
    if (!this.me) {
      if (this.seekingPoolId === id) {
        if (this.anonPoolRequest?.id === id) this.anonPoolRequest.cancelled = true;
        const ownHook = this.data.hooks.find(hook => hook.action === 'cancel');
        if (ownHook) this.socket.send('cancel', ownHook.id);
        this.seekingPoolId = undefined;
        this.redraw();
        return;
      }
      const pool = [...this.pools, ...this.homePools].find(p => p.id === id);
      if (!pool) return;
      const ownHook = this.data.hooks.find(hook => hook.action === 'cancel');
      if (ownHook) this.socket.send('cancel', ownHook.id);
      const request = { id, cancelled: false };
      this.anonPoolRequest = request;
      this.seekingPoolId = id;
      this.setTab('real_time');
      this.redraw();
      try {
        await xhr.anonPoolSeek(pool);
        if (request.cancelled) this.socket.send('cancel', id);
      } catch (_) {
        if (this.anonPoolRequest === request) {
          this.seekingPoolId = undefined;
          this.redraw();
        }
      } finally {
        if (this.anonPoolRequest === request) this.anonPoolRequest = undefined;
      }
    } else if (this.poolMember?.id === id) this.leavePool();
    else this.enterPool({ id });
    this.redraw();
  };

  onOwnHookAdded = (hook: Hook) => {
    const id = this.poolIdForHook(hook);
    if (this.homePools.some(pool => pool.id === id)) this.seekingPoolId = id;
  };

  onOwnHookRemoved = (hook: Hook) => {
    if (this.seekingPoolId === this.poolIdForHook(hook)) this.seekingPoolId = undefined;
  };

  syncOwnHookPool = () => {
    const ownHook = this.data.hooks.find(hook => hook.action === 'cancel');
    if (ownHook) this.onOwnHookAdded(ownHook);
    else if (!this.anonPoolRequest) this.seekingPoolId = undefined;
  };

  private readonly poolIdForHook = (hook: Hook): string => {
    if (!hook.moveTime) return hook.clock;
    const first = hook.moveTime.first;
    return `${hook.clock}-m${hook.moveTime.seconds}${first ? `-${first.seconds}x${first.moves}` : ''}`;
  };

  enterPool = (member: PoolMember) => {
    poolRangeStorage.set(this.me?.username, member.id, member.range);
    this.setTab('pools');
    this.poolMember = member;
    this.poolIn();
  };

  leavePool = () => {
    if (!this.poolMember) return;
    this.socket.poolOut(this.poolMember);
    this.poolMember = undefined;
  };

  poolIn = () => {
    if (!this.poolMember) return;
    this.poolInStorage.fire();
    this.socket.poolIn(this.poolMember);
  };

  hasOngoingRealTimeGame = (requireTurn: boolean) =>
    this.data.nowPlaying.some(
      nowPlaying =>
        nowPlaying.speed !== 'correspondence' &&
        (nowPlaying.isMyTurn || !requireTurn) &&
        !nowPlaying.opponent.ai,
    );

  gameActivity = (gameId: string) => {
    if (this.data.nowPlaying.some(p => p.gameId === gameId))
      xhr.nowPlaying().then(res => {
        this.data.nowPlaying = res.nowPlaying;
        this.data.nbMyTurn = res.nbMyTurn;
        this.startWatching();
        this.redraw();
      });
  };

  private startWatching() {
    const newIds = this.data.nowPlaying.map(p => p.gameId).filter(id => !this.alreadyWatching.includes(id));
    if (newIds.length) {
      setTimeout(() => this.socket.send('startWatching', newIds.join(' ')), 2000);
      newIds.forEach(id => this.alreadyWatching.push(id));
    }
  }

  setRedirecting = () => {
    this.redirecting = true;
    setTimeout(() => {
      this.redirecting = false;
      this.redraw();
    }, 4000);
    this.redraw();
  };

  awake = () => {
    switch (this.tab) {
      case 'real_time':
        this.data.hooks = [];
        this.socket.realTimeIn();
        break;
      case 'seeks':
        this.fetchSeeks();
        break;
    }
  };

  // after click on round "new opponent" button
  // also handles onboardink link for anon users
  private readonly joinPoolFromLocationHash = () => {
    if (location.hash.startsWith('#pool/')) {
      const regex = /^#pool\/(\d+\+\d+(?:-m\d+(?:-\d+x\d+)?)?)(?:\/(.+))?$/,
        match = regex.exec(location.hash),
        member: PoolMember = { id: match![1], blocking: match![2] },
        range = poolRangeStorage.get(this.me?.username, member.id);
      if (range) member.range = range;
      if (match) {
        this.setTab('pools');
        if (this.me) this.enterPool(member);
        else setTimeout(() => this.clickPool(member.id), 1500);
        history.replaceState(null, '', '/');
      }
    }
  };
}
