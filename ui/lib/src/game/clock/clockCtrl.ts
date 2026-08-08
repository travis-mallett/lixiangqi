import { ShowClockTenths } from '@/prefs';

import { updateElements, formatClockTimeVerbal } from './clockView';

export interface ClockOpts {
  onFlag(): void;
  bothPlayersHavePlayed(): boolean;
  hasGoneBerserk(color: Color): boolean;
  alarmColor?: Color;
}

export interface ClockConfig {
  initial: Seconds;
  increment: Seconds;
  moretime: Seconds;
}

// JSON data from the server
export interface ClockData extends ClockConfig {
  running: boolean;
  white: Seconds;
  black: Seconds;
  moveTime?: Seconds;
}
export interface ClockPref {
  clockTenths: ShowClockTenths;
  clockBar: boolean;
}

interface Times {
  white: Millis;
  black: Millis;
  moveTime?: Millis;
  activeColor?: Color;
  lastUpdate: Millis;
}

export interface ClockElements {
  time?: HTMLElement;
  clock?: HTMLElement;
  moveTime?: HTMLElement;
  moveClock?: HTMLElement;
  bar?: HTMLElement;
  barAnim?: Animation;
}

interface EmergSound {
  play(): void;
  next?: number;
  delay: Millis;
  playable: {
    white: boolean;
    black: boolean;
  };
}

export interface SetData {
  white: Seconds;
  black: Seconds;
  moveTime?: Seconds;
  ticking?: Color;
  delay?: Centis; // network lag to visually compensate
}

export class ClockCtrl {
  readonly config: ClockConfig;

  emergSound: EmergSound = {
    play: () => site.sound.play('lowTime'),
    delay: 20000,
    playable: {
      white: true,
      black: true,
    },
  };
  showTenths: (millis: Millis) => boolean;
  showBar: boolean;
  times: Times;
  barTime: number;
  timeRatioDivisor: number;
  emergMs: Millis;
  readonly moveEmergMs = 10000;
  hasMoveTime = false;
  alarmAction?: { seconds: Seconds; fire: () => void };
  elements: ByColor<ClockElements> = { white: {}, black: {} };

  private tickTimeout?: Timeout;

  constructor(
    data: ClockData,
    pref: ClockPref,
    ticking: Color | undefined,
    readonly opts: ClockOpts,
  ) {
    this.config = data;
    this.showTenths =
      pref.clockTenths === ShowClockTenths.Never
        ? () => false
        : pref.clockTenths === ShowClockTenths.Below10Secs
          ? time => time < 10000
          : time => time < 3600000;

    this.showBar = pref.clockBar && !site.blindMode;
    this.barTime = 1000 * (Math.max(data.initial, 2) + 5 * data.increment);
    this.timeRatioDivisor = 1 / this.barTime;

    this.emergMs =
      1000 *
      Math.min(60, data.initial < 60 ? Math.max(2, data.initial * 0.2) : Math.max(10, data.initial * 0.125));

    this.setClock({
      white: data.white,
      black: data.black,
      moveTime: data.moveTime,
      ticking,
    });
  }

  timeRatio = (millis: number): number => Math.min(1, millis * this.timeRatioDivisor);

  setClock = (d: SetData): void => {
    const delayMs = (d.delay || 0) * 10;
    if (d.moveTime !== undefined) this.hasMoveTime = true;

    this.times = {
      white: d.white * 1000,
      black: d.black * 1000,
      moveTime: d.moveTime === undefined ? undefined : d.moveTime * 1000,
      activeColor: d.ticking,
      lastUpdate: performance.now() + delayMs,
    };

    if (d.ticking)
      this.scheduleTick(
        Math.min(this.times[d.ticking], this.times.moveTime ?? Number.POSITIVE_INFINITY),
        delayMs,
      );
  };

  addTime = (color: Color, time: Centis): void => {
    this.times[color] += time * 10;
  };

  stopClock = (): Millis | void => {
    const color = this.times.activeColor;
    if (color) {
      const curElapse = this.elapsed();
      this.times[color] = Math.max(0, this.times[color] - curElapse);
      this.times.moveTime = undefined;
      this.times.activeColor = undefined;
      return curElapse;
    }
  };

  hardStopClock = (): void => {
    this.times.activeColor = undefined;
    this.times.moveTime = undefined;
  };

  private readonly scheduleTick = (time: Millis, extraDelay: Millis) => {
    if (this.tickTimeout !== undefined) clearTimeout(this.tickTimeout);
    // changing the value of active node confuses the chromevox screen reader
    // so update the clock less often for blind mode.
    // Otherwise: on the 500ms because that affects separator
    // When tenths are shown, update every 100ms to show tenths.
    const tickInterval = site.blindMode ? 1000 : this.showTenths(time) ? 100 : 500;

    // Schedule the next tick to occur immediately after the interval boundary.
    // Note that extraDelay is a value from server which predicts opp lag comp.
    // It delays a clock from counting down, so should be included in the
    // calculation of scheduling (when the clock display will need to be updated)
    this.tickTimeout = setTimeout(this.tick, (time % tickInterval) + 1 + extraDelay);
  };

  // Should only be invoked by scheduleTick.
  private readonly tick = (): void => {
    this.tickTimeout = undefined;

    const color = this.times.activeColor;
    if (color === undefined) return;

    const now = performance.now();
    const bankMillis = this.millisOf(color, now);
    const moveMillis = this.moveTimeMillis(now);
    const effectiveMillis = Math.min(bankMillis, moveMillis ?? Number.POSITIVE_INFINITY);

    this.scheduleTick(effectiveMillis, 0);
    updateElements(this, this.elements[color], bankMillis, moveMillis);
    if (effectiveMillis === 0) this.opts.onFlag();

    if (this.opts.alarmColor === color) {
      if (this.alarmAction && bankMillis < this.alarmAction.seconds * 1000) {
        this.alarmAction.fire();
        this.alarmAction = undefined;
      }
      const inTimeTrouble =
        bankMillis < this.emergMs || (moveMillis !== undefined && moveMillis < this.moveEmergMs);
      if (this.emergSound.playable[color]) {
        if (inTimeTrouble && !(now < this.emergSound.next!)) {
          this.emergSound.play();
          this.emergSound.next = now + this.emergSound.delay;
          this.emergSound.playable[color] = false;
        }
      } else if (
        bankMillis > 1.5 * this.emergMs &&
        (moveMillis === undefined || moveMillis > 1.5 * this.moveEmergMs)
      ) {
        this.emergSound.playable[color] = true;
      }
    }
  };

  elapsed = (now: number = performance.now()): number => Math.max(0, now - this.times.lastUpdate);

  millisOf = (color: Color, now: number = performance.now()): Millis => {
    if (this.times.activeColor !== color) return this.times[color];
    return Math.max(0, this.times[color] - this.elapsed(now));
  };

  moveTimeMillis = (now: number = performance.now()): Millis | undefined => {
    if (this.times.activeColor === undefined || this.times.moveTime === undefined) return undefined;
    return Math.max(0, this.times.moveTime - this.elapsed(now));
  };

  isRunning = (): boolean => this.times.activeColor !== undefined;

  speak = (): void => {
    const msgs = [
      { key: 'white', i18nName: i18n.site.white },
      { key: 'black', i18nName: i18n.site.black },
    ].map(color => {
      const time = this.millisOf(color.key as Color);
      const msg = formatClockTimeVerbal(time);
      return `${color.i18nName} - ${msg}`;
    });
    site.sound.say(msgs.join('. '), false, true, true);
  };
}
