import { clockToSpeed } from '@/game';
import { propWithEffect, type Prop } from '@/index';

import type { ClockConfig, InputValue, MoveTimeLimitConfig, RealValue } from './interfaces';

export type TimeMode = 'realTime' | 'correspondence' | 'unlimited';

export class TimeControl {
  constructor(
    readonly mode: Prop<TimeMode>,
    readonly modes: TimeMode[],
    // The following three quantities are suffixed with 'V' to draw attention to the
    // fact that they are not the true quantities. They represent the value of the
    // input element. Use time(), increment(), and days() below for the true quantities.
    readonly timeV: Prop<InputValue>,
    readonly incrementV: Prop<InputValue>,
    readonly daysV: Prop<InputValue>,
    readonly moveTime: Prop<MoveTimeLimitConfig | undefined>,
    readonly presets: ClockConfig[],
  ) {}

  time: () => RealValue = () => timeVToTime(this.timeV());
  increment: () => RealValue = () => incrementVToIncrement(this.incrementV());
  days: () => RealValue = () => daysVToDays(this.daysV());

  isRealTime = (): boolean => this.mode() === 'realTime';

  realTimeValid = (minimumTime = 0): boolean =>
    this.time() >= minimumTime && (this.time() > 0 || this.increment() > 0);

  valid = (minimumTimeIfReal = 0): boolean =>
    !this.isRealTime() || (this.realTimeValid(minimumTimeIfReal) && this.moveTimeValid());

  moveTimeValid = (): boolean => {
    const limit = this.moveTime();
    return (
      !limit ||
      (validMoveSeconds(limit.seconds) &&
        (!limit.first || (validFirstMoves(limit.first.moves) && validMoveSeconds(limit.first.seconds))))
    );
  };

  setMoveTimeEnabled = (enabled: boolean): void => {
    this.moveTime(enabled ? this.moveTime() || { seconds: 90 } : undefined);
  };

  setMoveTimeSeconds = (seconds: number): void => {
    this.moveTime({ ...(this.moveTime() || { seconds: 90 }), seconds });
  };

  setFirstMoveTimeEnabled = (enabled: boolean): void => {
    const limit = this.moveTime() || { seconds: 90 };
    this.moveTime({ ...limit, first: enabled ? limit.first || { moves: 3, seconds: 30 } : undefined });
  };

  setFirstMoves = (moves: number): void => {
    const limit = this.moveTime()!;
    this.moveTime({ ...limit, first: { ...(limit.first || { moves: 3, seconds: 30 }), moves } });
  };

  setFirstMoveSeconds = (seconds: number): void => {
    const limit = this.moveTime()!;
    this.moveTime({ ...limit, first: { ...(limit.first || { moves: 3, seconds: 30 }), seconds } });
  };

  matchesPreset = (preset: ClockConfig): boolean =>
    this.time() === preset.lim &&
    this.increment() === preset.inc &&
    sameMoveTime(this.moveTime(), preset.moveTime);

  selectPreset = (preset: ClockConfig): void => {
    this.timeV(sliderInitVal(preset.lim, timeVToTime, 100, 9));
    this.incrementV(sliderInitVal(preset.inc, incrementVToIncrement, 100, 0));
    this.moveTime(preset.moveTime);
  };

  initialSeconds = (): Seconds => this.time() * 60;

  notForRatedVariant = (): boolean =>
    !this.isRealTime() ||
    (this.time() < 0.5 && this.increment() === 0) ||
    (this.time() === 0 && this.increment() < 2);

  clockStr = (): string => `${this.time()}+${this.increment()}`;

  speed = (): Speed =>
    this.isRealTime() ? clockToSpeed(this.initialSeconds(), this.increment()) : 'correspondence';

  canSelectMode = (): boolean => this.modes.length > 1;
}

export const timeControlFromStoredValues = (
  mode: Prop<TimeMode>,
  modes: TimeMode[],
  time: RealValue,
  inc: RealValue,
  days: RealValue,
  moveTime: MoveTimeLimitConfig | undefined,
  onChange: () => void,
  presets: ClockConfig[],
): TimeControl =>
  new TimeControl(
    mode,
    modes,
    propWithEffect(sliderInitVal(time, timeVToTime, 100, 14), onChange),
    propWithEffect(sliderInitVal(inc, incrementVToIncrement, 100, 5), onChange),
    propWithEffect(sliderInitVal(days, daysVToDays, 20, 7), onChange),
    propWithEffect(moveTime, onChange),
    presets,
  );

const validMoveSeconds = (seconds: number): boolean =>
  Number.isInteger(seconds) && seconds >= 1 && seconds <= 300;

const validFirstMoves = (moves: number): boolean => Number.isInteger(moves) && moves >= 1 && moves <= 20;

const sameMoveTime = (a?: MoveTimeLimitConfig, b?: MoveTimeLimitConfig): boolean =>
  a?.seconds === b?.seconds && a?.first?.moves === b?.first?.moves && a?.first?.seconds === b?.first?.seconds;

export const formatMoveTime = (limit: MoveTimeLimitConfig): string =>
  limit.first
    ? i18n.site.moveTimeLimitDescription(limit.first.seconds, limit.first.moves, limit.seconds)
    : i18n.site.secondsPerMove(limit.seconds);

export const formatMoveTimeShort = (limit: MoveTimeLimitConfig): string =>
  limit.first
    ? i18n.site.moveTimeLimitShort(limit.first.seconds, limit.first.moves, limit.seconds)
    : i18n.site.secondsPerMove(limit.seconds);

export const formatMoveTimeCompact = (limit: MoveTimeLimitConfig): string =>
  limit.first
    ? `${limit.first.seconds}s × ${limit.first.moves} → ${limit.seconds}s/move`
    : `${limit.seconds}s/move`;

export const formatClock = (clock: string, moveTime?: MoveTimeLimitConfig): string =>
  moveTime ? `${clock} · ${formatMoveTimeShort(moveTime)}` : clock;

export const poolId = (clock: string, moveTime?: MoveTimeLimitConfig): string => {
  if (!moveTime) return clock;
  const opening = moveTime.first ? `-${moveTime.first.seconds}x${moveTime.first.moves}` : '';
  return `${clock}-m${moveTime.seconds}${opening}`;
};

export const timeModes: { id: number; key: TimeMode; name: string }[] = [
  { id: 1, key: 'realTime', name: i18n.site.realTime },
  { id: 2, key: 'correspondence', name: i18n.site.correspondence },
  { id: 0, key: 'unlimited', name: i18n.site.unlimited },
];

export const allTimeModeKeys: TimeMode[] = ['realTime', 'correspondence', 'unlimited'];

// When we store timeV, incrementV, and daysV in local storage, we save the actual time, increment,
// and days, and not the value of the input element. We use this function to recompute the value of the
// input element.
export const sliderInitVal = (
  v: RealValue,
  f: (x: InputValue) => RealValue,
  max: InputValue,
  defaultVal: InputValue,
): InputValue => {
  for (let i = 0; i < max; i++) {
    if (f(i) === v) return i;
  }
  return defaultVal;
};

export const sliderTimes: number[] = [
  0,
  1 / 4,
  1 / 2,
  3 / 4,
  1,
  3 / 2,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  20,
  25,
  30,
  35,
  40,
  45,
  60,
  75,
  90,
  105,
  120,
  135,
  150,
  165,
  180,
];

export const timeVToTime = (v: InputValue): RealValue => (v < sliderTimes.length ? sliderTimes[v] : 180);

export const incrementVToIncrement = (v: InputValue): RealValue => {
  if (v <= 20) return v;
  switch (v) {
    case 21:
      return 25;
    case 22:
      return 30;
    case 23:
      return 35;
    case 24:
      return 40;
    case 25:
      return 45;
    case 26:
      return 60;
    case 27:
      return 90;
    case 28:
      return 120;
    case 29:
      return 150;
    default:
      return 180;
  }
};

export const daysVToDays = (v: InputValue): RealValue => {
  if (v <= 3) return v;
  switch (v) {
    case 4:
      return 5;
    case 5:
      return 7;
    case 6:
      return 10;
    default:
      return 14;
  }
};
