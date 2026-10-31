import type { BoardView } from '@lixiangqi/board';
import {
  position,
  interaction,
  transition,
  playbackTransition,
  Engine,
  colors,
  request,
  errorText,
  download,
  type Bootstrap,
  type Color,
  type Game,
  type Rules,
  type State,
  type Challenge,
} from 'threeKingdoms';

import { toggle } from 'lib';
import { randomId } from 'lib/algo';
import { createXiangqiBoard, websiteBoardPresentation, makeBoardResizable } from 'lib/board';
import { licon, type LiconValue } from 'lib/licon';
import { wsSetActivity } from 'lib/socket';
import { hl, bind, onInsert, bindReplayEvents, toggleButton, type VNode, type LooseVNodes } from 'lib/view';
import { userLink } from 'lib/view/userLink';

import { roundAction } from '../view/actions';
import { roomBoardMenu } from '../view/boardMenu';
import { replayNavigation, replayMoves, bindReplayKeyboard, replayWheel } from '../view/navigation';
import { mountRoom, roomView, tableView } from '../view/room';
import { Chat } from './threeKingdomsChat';

export class Round {
  private game: Game;
  private readonly localOwner;
  private readonly guestColor?: Color;
  private archivingLocal = false;
  private state: State;
  private states: State[] = [];
  private cursor = 0;
  private perspective: Color;
  private board: BoardView;
  private readonly engine = new Engine();
  private readonly container: HTMLElement;
  private readonly room: ReturnType<typeof mountRoom>;
  private readonly menu = toggle(false, () => this.render());
  private error = '';
  private engineFailed = false;
  private source?: EventSource;
  private busy = false;
  private searching?: string;
  private botTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;
  private serverOffset = 0;
  private bookmarked = false;
  private readonly chat?: Chat;
  private readonly unbindKeyboard: () => void;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    root: HTMLElement,
    game: Game,
    private readonly rules: Rules,
    private readonly bootstrap: Bootstrap,
    private local = false,
  ) {
    this.container = root.parentElement!;
    this.game = game;
    this.localOwner = local || localStorage.getItem('threeKingdoms.guestGame') === game.id;
    this.guestColor = this.localOwner
      ? game.seats.find(s => s.guest || s.user?.id === 'local')?.color
      : undefined;
    this.state = rules.inspect(game.position);
    this.perspective = this.myColor() ?? 'red';
    this.replay();
    this.room = mountRoom(root, () => this.view());
    if (!local) {
      const side = document.querySelector<HTMLElement>('.round__side');
      if (side) this.chat = new Chat(side, game.id, bootstrap.me);
    }
    this.unbindKeyboard = bindReplayKeyboard({
      previous: () => this.select(this.cursor - 1),
      next: () => this.select(this.cursor + 1),
      first: () => this.select(0),
      last: () => this.select(this.states.length - 1),
      flip: this.rotate,
    });
    this.serverOffset = local ? 0 : game.serverTime - Date.now();
    if (this.localOwner) this.persistLocal();
    this.render();
    this.timer = setInterval(() => this.tick(), 200);
    window.addEventListener('pagehide', () => this.destroy(), { once: true });
    if (!local) this.connect();
    if (!local && bootstrap.me)
      void request<{ bookmarked: boolean }>(`game/${game.id}/bookmark`)
        .then(result => {
          if (!this.destroyed) {
            this.bookmarked = result.bookmarked;
            this.render();
          }
        })
        .catch(() => {});
    this.bot();
  }

  private myColor(): Color | undefined {
    return (
      this.game.seats.find(seat => seat.user?.id === (this.bootstrap.me ?? 'local'))?.color ?? this.guestColor
    );
  }

  private replay(): void {
    let encoded = this.game.initial;
    this.states = [this.rules.inspect(encoded)];
    for (const event of this.game.events) {
      encoded = this.rules.event(encoded, event.actor, event.action);
      this.states.push(this.rules.inspect(encoded));
    }
    this.cursor = this.states.length - 1;
  }

  private connect(): void {
    this.source?.close();
    this.source = new EventSource(`/api/three-kingdoms/game/${this.game.id}/stream`);
    this.source.onmessage = event => {
      const data = JSON.parse(event.data);
      if (data.position) void this.receive(data as Game);
    };
    this.source.onerror = () => {
      this.error = i18n.threeKingdoms.reconnecting;
      this.render();
    };
    this.source.onopen = () => {
      this.error = '';
      this.render();
    };
  }

  private async receive(next: Game): Promise<void> {
    if (this.destroyed || next.revision <= this.game.revision) return;
    if (next.events.length !== next.eventCount) {
      if (next.eventCount === this.game.eventCount + 1) next.events = [...this.game.events, ...next.events];
      else if (next.eventCount === this.game.eventCount && next.position === this.game.position)
        next.events = this.game.events;
      else {
        try {
          return this.receive(await request<Game>(`game/${next.id}?history=true`));
        } catch (e) {
          this.error = errorText(e);
          return;
        }
      }
    }
    const before = this.state;
    const wasLive = this.cursor === this.states.length - 1;
    const cursor = this.cursor;
    this.game = next;
    this.serverOffset = this.local ? 0 : next.serverTime - Date.now();
    this.state = this.rules.inspect(next.position);
    if (next.eventCount === this.states.length) this.states.push(this.state);
    else if (next.eventCount + 1 !== this.states.length) this.replay();
    if (next.eventCount + 1 === this.states.length) this.states[this.states.length - 1] = this.state;
    this.cursor = wasLive ? this.states.length - 1 : Math.min(cursor, this.states.length - 1);
    this.board.display(
      position(this.states[this.cursor]),
      wasLive && before.position !== next.position
        ? transition(before, this.state, `${next.id}:${next.revision}`)
        : { kind: 'jump' },
    );
    this.engine.stop();
    clearTimeout(this.botTimer);
    this.searching = undefined;
    this.render();
    if (this.localOwner) this.persistLocal();
    this.bot();
  }

  private select(index: number): void {
    const previous = this.cursor;
    this.cursor = Math.max(0, Math.min(this.states.length - 1, index));
    this.board.display(
      position(this.states[this.cursor]),
      playbackTransition(
        this.states[previous],
        this.states[this.cursor],
        this.cursor === previous + 1 ? 'forward' : this.cursor === previous - 1 ? 'backward' : 'jump',
        `${this.game.id}:replay:${this.cursor}`,
      ),
    );
    this.render();
  }

  private render(): void {
    const me = this.myColor();
    const active = !!me && this.state.active.includes(me);
    wsSetActivity(
      active && !this.state.ending
        ? `threeKingdoms-${this.game.seats.some(s => s.aiLevel) ? 'ai' : this.game.rated ? 'rated' : 'friend'}`
        : undefined,
    );
    this.board.setInteraction(
      interaction(
        this.state,
        move => void this.act(move),
        this.cursor === this.states.length - 1 && active && !this.busy ? me : undefined,
        this.bootstrap.preferences,
      ),
    );
    this.room.redraw();
    this.tick();
  }

  private readonly rotate = (): void => {
    this.perspective = colors[(colors.indexOf(this.perspective) + 1) % 3];
    this.board.setPresentation(
      websiteBoardPresentation(this.bootstrap.preferences, 'interactive', this.perspective),
    );
    this.render();
  };

  private view(): VNode {
    const t = i18n.threeKingdoms;
    const me = this.myColor();
    const active = !!me && this.state.active.includes(me);
    const live = this.cursor === this.states.length - 1;
    const button = (label: string, action: () => void, icon?: LiconValue) =>
      roundAction(label, action, { icon, disabled: this.busy });
    const link = (label: string, href: string) => hl('a.fbt', { attrs: { href } }, label);
    const actions: LooseVNodes = [];
    const followUp: LooseVNodes = [];
    const notices: LooseVNodes = [];
    if (!active || this.state.ending) followUp.push(link(t.leave, '/'));
    let status: string;
    if (this.state.ending) {
      status = t.finished;
      if (me) followUp.push(button(t.rematch, () => void this.rematch()));
    } else if (!live) {
      status = `${this.cursor} / ${this.states.length - 1}`;
      followUp.push(button(t.returnLive, () => this.select(this.states.length - 1)));
    } else {
      status = `${!active ? (me ? t.eliminated : t.spectating) : ''} ${t.turn(t[this.state.turn])}`;
      if (this.state.noSafeEscape) notices.push(hl('p', t.noSafeEscape));
      if (active && this.state.checked.includes(me) && !this.state.noSafeEscape)
        notices.push(hl('p', t.mustResolveCheck));
      if (this.state.perpetualWarning) notices.push(hl('p', t.perpetualWarning));
      if (active) {
        actions.push(
          button(
            t.resign,
            () => {
              if (confirm(t.confirmResign)) void this.act('resign');
            },
            licon.FlagOutline,
          ),
          button(t.draw, () => void this.act('draw'), licon.OneHalf),
        );
      }
      if (this.game.drawOffers.length)
        notices.push(hl('p', t.drawOffered(this.game.drawOffers.map(c => t[c]).join(', '))));
      if (
        me &&
        (!this.localOwner || this.local) &&
        !this.game.rated &&
        !this.game.tournamentId &&
        this.game.events[this.game.events.length - 1]?.action.includes('>') &&
        this.states[this.states.length - 2]?.active.includes(me)
      )
        actions.push(button(t.takeback, () => void this.act('takeback'), licon.Back));
      if (this.game.takebackOffers.length)
        notices.push(hl('p', t.takebackOffered(this.game.takebackOffers.map(c => t[c]).join(', '))));
    }
    if (this.state.ending || !active)
      followUp.push(link(t.analysis, `/analysis/threeKingdoms?game=${this.game.id}`));
    if (this.game.tournamentId)
      followUp.push(link(i18n.site.backToTournament, `/tournament/${this.game.tournamentId}`));
    followUp.push(
      button(t.export, () => download(JSON.stringify(this.game), `three-kingdoms-${this.game.id}.json`)),
    );
    if (!this.local && this.bootstrap.me)
      followUp.push(
        hl(
          'button.fbt',
          {
            attrs: { type: 'button', 'aria-pressed': String(this.bookmarked) },
            hook: bind('click', () => {
              void request<{ bookmarked: boolean }>(`game/${this.game.id}/bookmark`, {
                bookmarked: !this.bookmarked,
              })
                .then(result => {
                  this.bookmarked = result.bookmarked;
                  this.render();
                })
                .catch(error => {
                  this.error = errorText(error);
                  this.render();
                });
            }),
          },
          i18n.site.bookmarkThisGame,
        ),
      );
    const seat = (color: Color) => {
      const player = this.game.seats.find(s => s.color === color)!;
      const owner = this.state.controllers[colors.indexOf(color)];
      const place = this.placement(color);
      return hl(
        'div.round__seat',
        {
          key: color,
          class: { eliminated: !this.state.active.includes(color) },
          attrs: { 'data-seat': color },
        },
        [
          hl('div.ruser.user-link', [
            hl('span.round__army', t[color]),
            player.user
              ? player.user.id !== 'local' && userLink({ name: player.user.name, online: false, line: false })
              : hl('name', player.guest ? i18n.site.anonymous : `${i18n.site.computer} ${player.aiLevel}`),
            player.rank && hl('rank', player.rank),
          ]),
          hl('div.rclock', { class: { running: color === this.state.turn && !this.state.ending } }, [
            hl('div.time', { attrs: { 'data-clock': color } }),
            hl('div.rclock-move', {
              class: { active: color === this.state.turn && !this.state.ending },
              attrs: { 'data-deadline': color },
            }),
          ]),
          owner !== color && hl('small', owner ? t.controls(t[owner]) : t.removedArmy),
          place !== undefined && hl('strong', t.place(place)),
        ],
      );
    };
    return roomView('threeKingdoms', [
      hl(
        'div.round__app__board',
        {
          hook: replayWheel(
            () => this.select(this.cursor - 1),
            () => this.select(this.cursor + 1),
            () => !!this.myColor() && this.state.active.includes(this.myColor()!) && !this.state.ending,
          ),
        },
        [
          hl('div.round__graph-board', {
            hook: onInsert(element => {
              this.board = createXiangqiBoard(
                element,
                position(this.state),
                websiteBoardPresentation(this.bootstrap.preferences, 'interactive', this.perspective),
              );
              makeBoardResizable(this.board);
            }),
          }),
        ],
      ),
      tableView([
        hl('div.round__seats.ruser-top', colors.filter(c => c !== this.perspective).map(seat)),
        hl('div.round__seats.ruser-bottom', [seat(this.perspective)]),
        hl('i5d', [
          replayNavigation(
            0,
            this.cursor,
            this.states.length - 1,
            bindReplayEvents(event => {
              const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-ply]');
              if (target && !target.disabled) this.select(Number(target.dataset.ply));
            }),
            button(t.rotate, this.rotate, licon.ChasingArrows),
            toggleButton(this.menu, i18n.site.menu),
          ),
          roomBoardMenu(() => this.render(), this.menu, this.perspective !== this.myColor(), this.rotate),
          replayMoves(
            hl(
              'ol.round__event-moves',
              this.game.events.map((event, index) => {
                const notation = event.action.includes('>')
                  ? this.rules.notation(this.states[index].position, event.action)
                  : ((t as unknown as Record<string, string>)[event.action] ?? event.action);
                return hl('li', { class: { a1t: index + 1 === this.cursor } }, [
                  button(`${t[event.actor]}: ${notation}`, () => this.select(index + 1)),
                ]);
              }),
            ),
            this.cursor,
            0,
            this.states.length - 1,
            bindReplayEvents(event => {
              const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-ply]');
              if (target && !target.disabled) this.select(Number(target.dataset.ply));
            }),
          ),
        ]),
        hl('div.rcontrols', [
          hl('p.status', { attrs: { role: 'status' } }, status),
          hl('p.error', { attrs: { role: 'alert' } }, this.error),
          this.engineFailed &&
            button(t.retry, () => {
              this.engineFailed = false;
              this.bot();
            }),
          hl('div.ricons', [actions, toggleButton(this.menu, i18n.site.menu)]),
          notices,
          hl('div.follow-up', followUp),
        ]),
      ]),
    ]);
  }

  private placement(color: Color): number | undefined {
    const index = this.state.eliminated.findIndex(e => e.player === color);
    return index >= 0
      ? 3 - index
      : this.state.ending
        ? this.state.ending.draw
          ? (this.state.active.length + 1) / 2
          : 1
        : undefined;
  }

  private tick(): void {
    if (this.destroyed) return;
    const now = Date.now() + this.serverOffset;
    this.container.querySelectorAll<HTMLElement>('[data-clock]').forEach(element => {
      const color = element.dataset.clock as Color;
      const running = color === this.state.turn && !this.state.ending;
      const remaining = Math.max(
        0,
        this.game.clock.remaining[colors.indexOf(color)] -
          (running ? Math.max(0, now - this.game.clock.startedAt) : 0),
      );
      const seconds = Math.ceil(remaining / 1000);
      const deadline =
        running && this.game.clock.deadline
          ? Math.max(0, Math.ceil((this.game.clock.deadline - now) / 1000))
          : undefined;
      element.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      const moveClock = element.parentElement!.querySelector<HTMLElement>('[data-deadline]')!;
      moveClock.textContent = deadline === undefined ? '' : String(deadline);
    });
    if (
      this.local &&
      this.state.active.includes(this.myColor()!) &&
      !this.state.ending &&
      this.game.clock.deadline !== null &&
      this.game.clock.deadline <= now &&
      !this.busy
    )
      void this.localAction('timeout', this.state.turn);
  }

  private async act(action: string): Promise<void> {
    if (this.busy) return;
    if (this.local) return this.localAction(action, action.includes('>') ? this.state.turn : this.myColor()!);
    this.busy = true;
    this.render();
    try {
      await this.receive(
        await request<Game>(`game/${this.game.id}`, { revision: this.game.revision, action }),
      );
      this.error = '';
    } catch (error) {
      this.error = errorText(error);
      try {
        await this.receive(await request<Game>(`game/${this.game.id}?history=true`));
      } catch {
        /* EventSource retries. */
      }
    } finally {
      this.busy = false;
      this.render();
      this.bot();
    }
  }

  private async localAction(action: string, actor: Color): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (action === 'takeback') {
        let index = this.game.events.length - 1;
        while (
          index >= 0 &&
          !(this.game.events[index].actor === this.myColor() && this.game.events[index].action.includes('>'))
        )
          index--;
        if (
          this.state.ending ||
          index < 0 ||
          !this.game.events[this.game.events.length - 1]?.action.includes('>')
        )
          throw new Error('takebackUnavailable');
        const events = this.game.events.slice(0, index);
        let restored = this.game.initial;
        for (const event of events) restored = this.rules.event(restored, event.actor, event.action);
        const now = Date.now();
        const remaining =
          events[events.length - 1]?.clocks ?? colors.map(() => this.game.clock.initialSeconds * 1000);
        const turn = this.rules.inspect(restored).turn;
        await this.receive({
          ...this.game,
          events,
          eventCount: events.length,
          position: restored,
          revision: this.game.revision + 1,
          serverTime: now,
          clock: {
            ...this.game.clock,
            remaining,
            startedAt: now,
            deadline: now + Math.min(this.game.clock.moveSeconds * 1000, remaining[colors.indexOf(turn)]),
          },
        });
      } else {
        const now = Date.now();
        const nextPosition = this.rules.event(this.game.position, actor, action);
        const next = this.rules.inspect(nextPosition);
        const remaining = this.game.clock.remaining.slice();
        const index = colors.indexOf(this.state.turn);
        const switches = next.turn !== this.state.turn || !!next.ending || action.includes('>');
        if (switches) remaining[index] = Math.max(0, remaining[index] - (now - this.game.clock.startedAt));
        const startedAt = switches ? now : this.game.clock.startedAt;
        const event = { action, actor, at: now, clocks: remaining };
        await this.receive({
          ...this.game,
          position: nextPosition,
          revision: this.game.revision + 1,
          serverTime: now,
          events: [...this.game.events, event],
          eventCount: this.game.eventCount + 1,
          finished: !!next.ending,
          clock: {
            ...this.game.clock,
            remaining,
            startedAt,
            deadline: next.ending
              ? null
              : startedAt +
                Math.min(this.game.clock.moveSeconds * 1000, remaining[colors.indexOf(next.turn)]),
          },
        });
      }
    } catch (error) {
      this.error = errorText(error);
    } finally {
      this.busy = false;
      this.render();
      this.bot();
    }
  }

  private async archiveLocal(): Promise<void> {
    if (this.archivingLocal || this.engineFailed) return;
    this.archivingLocal = true;
    try {
      const payload = {
        id: this.game.id.replace('local-', ''),
        guest: this.myColor(),
        level: this.game.seats.find(s => s.aiLevel)!.aiLevel,
        initialSeconds: this.game.clock.initialSeconds,
        moveSeconds: this.game.clock.moveSeconds,
        events: this.game.events,
        elapsed: Math.max(0, Date.now() - this.game.clock.startedAt),
      };
      const next = await request<Game>(
        'complete-local',
        payload,
        'POST',
        JSON.stringify(payload).length < 60000,
      );
      try {
        localStorage.setItem('threeKingdoms.guestGame', next.id);
        localStorage.setItem('threeKingdoms.localGame', JSON.stringify(next));
      } catch {
        /* Storage failure must not interrupt managed completion. */
      }
      if (this.destroyed) return;
      this.local = false;
      this.game = { ...this.game, revision: -1 };
      await this.receive(next);
    } catch (error) {
      this.error = errorText(error);
      this.engineFailed = true;
      if (!this.destroyed) this.render();
    } finally {
      this.archivingLocal = false;
    }
  }

  private bot(): void {
    if (this.local && !this.state.ending && !this.state.active.includes(this.myColor()!)) {
      void this.archiveLocal();
      return;
    }
    const seat = this.game.seats.find(s => s.color === this.state.turn);
    if (
      this.destroyed ||
      this.busy ||
      this.state.ending ||
      !seat?.aiLevel ||
      !this.myColor() ||
      (!this.local && !this.state.active.includes(this.myColor()!)) ||
      this.searching === this.game.position
    )
      return;
    const position = (this.searching = this.game.position);
    const startedAt = performance.now();
    const revision = this.game.revision;
    this.engine
      .analyze(position, seat.aiLevel)
      .then(result => {
        if (!this.destroyed && position === this.game.position) {
          const move = result.lines[0]?.pvMoves[0];
          if (!move) throw new Error('No engine move for an active position');
          const play = () => {
            if (!this.destroyed && revision === this.game.revision && position === this.game.position)
              void this.act(move);
          };
          // Search time counts toward each opponent's minimum response time.
          const remaining = 2000 - (performance.now() - startedAt);
          if (remaining > 0) this.botTimer = setTimeout(play, remaining);
          else play();
        }
      })
      .catch(error => {
        if (error.name === 'AbortError') return;
        this.searching = undefined;
        this.error = i18n.threeKingdoms.engineUnavailable;
        this.engineFailed = true;
        this.render();
      });
  }

  private async rematch(): Promise<void> {
    if (this.localOwner) {
      location.href = '/?variant=threeKingdoms#ai';
      return;
    }
    try {
      const bot = this.game.seats.find(s => s.aiLevel);
      if (bot) {
        const g = await request<Game>('computer', {
          color: this.myColor(),
          level: bot.aiLevel,
          initialSeconds: this.game.clock.initialSeconds,
          moveSeconds: this.game.clock.moveSeconds,
        });
        location.href = `/three-kingdoms/game/${g.id}`;
      } else {
        const c = await request<Challenge>('challenge', {
          opponents: this.game.seats.flatMap(s =>
            s.user && s.user.id !== this.bootstrap.me ? [s.user.id] : [],
          ),
          initialSeconds: this.game.clock.initialSeconds,
          moveSeconds: this.game.clock.moveSeconds,
        });
        location.href = `/three-kingdoms/challenge/${c.id}`;
      }
    } catch (error) {
      this.error = errorText(error);
    }
  }

  private persistLocal(): void {
    try {
      localStorage.setItem('threeKingdoms.localGame', JSON.stringify(this.game));
      if (this.state.ending) {
        const history = JSON.parse(localStorage.getItem('threeKingdoms.localHistory') ?? '[]') as Game[];
        localStorage.setItem(
          'threeKingdoms.localHistory',
          JSON.stringify([this.game, ...history.filter(g => g.id !== this.game.id)].slice(0, 30)),
        );
      }
    } catch {
      /* Private browsing and full storage do not interrupt play. */
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    if (this.local && !this.state.ending && this.state.active.includes(this.myColor()!))
      void this.localAction('resign', this.myColor()!);
    if (!this.local && !this.state.ending && this.game.source === 'computer' && this.myColor())
      void request(
        `game/${this.game.id}`,
        {
          revision: this.game.revision,
          action: 'leave-computer',
        },
        'POST',
        true,
      ).catch(() => {});
    this.destroyed = true;
    clearInterval(this.timer);
    clearTimeout(this.botTimer);
    this.source?.close();
    this.engine.stop();
    this.chat?.destroy();
    this.board.destroy();
    this.room.destroy();
    this.unbindKeyboard();
    wsSetActivity();
  }
}

export function localGame(
  rules: Rules,
  color: Color,
  level: number,
  initialSeconds: number,
  moveSeconds: number,
): Game {
  const now = Date.now();
  return {
    id: `local-${randomId(8)}`,
    variant: 'threeKingdoms',
    rules: 'threeKingdoms-v1',
    revision: 0,
    eventCount: 0,
    position: rules.initial(),
    initial: rules.initial(),
    rated: false,
    source: 'computer',
    createdAt: now,
    serverTime: now,
    clock: {
      remaining: colors.map(() => initialSeconds * 1000),
      startedAt: now,
      initialSeconds,
      moveSeconds,
      deadline: now + moveSeconds * 1000,
    },
    seats: colors.map(c => ({
      color: c,
      kingdom: { black: 'wei', green: 'wu', red: 'shu' }[c],
      aiLevel: c === color ? null : level,
      user: c === color ? { id: 'local', name: i18n.threeKingdoms[c] } : null,
      rank: null,
      place: null,
      eliminated: false,
    })),
    events: [],
    drawOffers: [],
    takebackOffers: [],
    finished: false,
  };
}
