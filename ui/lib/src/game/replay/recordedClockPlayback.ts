export interface RecordedClockPosition {
  white: number;
  black: number;
}

export interface RecordedClockTimeline {
  startPly: number;
  positions: RecordedClockPosition[];
  delays: number[];
}

export interface RecordedClockFrame {
  white: Millis;
  black: Millis;
  activeColor?: Color;
}

export interface RecordedClockPlaybackAdapter {
  currentPosition(): number;
  goToPosition(position: number): void;
  renderClock(frame: RecordedClockFrame): void;
  stateChanged?(playing: boolean): void;
  ended?(): void;
}

const TICK_MILLIS = 100;

/** Drives recorded moves and interpolated clocks without knowing about a board or move tree. */
export class RecordedClockPlayback {
  private position: number;
  private elapsedMillis = 0;
  private segmentStartedAt = 0;
  private timer?: number;
  private playing = false;
  private readonly onVisibilityChange = () => {
    if (document.hidden) this.stop();
  };

  constructor(
    readonly timeline: RecordedClockTimeline,
    private readonly adapter: RecordedClockPlaybackAdapter,
  ) {
    if (!isRecordedClockTimeline(timeline)) throw new Error('Invalid recorded clock timeline');
    this.position = this.clampPosition(adapter.currentPosition());
    this.renderExact();
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  isPlaying = (): boolean => this.playing;

  currentPosition = (): number => this.position;

  hasNext = (): boolean => this.position < this.timeline.delays.length;

  select(position: number): void {
    this.cancelTimer();
    this.playing = false;
    this.position = this.clampPosition(position);
    this.elapsedMillis = 0;
    this.renderExact();
    this.adapter.stateChanged?.(false);
  }

  toggle(): void {
    if (this.playing) this.stop();
    else this.start();
  }

  start(): void {
    if (this.playing) return;
    if (!this.hasNext()) {
      this.position = 0;
      this.elapsedMillis = 0;
      this.adapter.goToPosition(0);
    }
    this.playing = true;
    this.segmentStartedAt = performance.now() - this.elapsedMillis;
    this.adapter.stateChanged?.(true);
    this.tick();
  }

  stop(): void {
    if (!this.playing) return;
    this.update(performance.now());
    this.playing = false;
    this.cancelTimer();
    this.adapter.renderClock(this.frame(this.elapsedMillis, undefined));
    this.adapter.stateChanged?.(false);
  }

  append(position: RecordedClockPosition, delay: number): boolean {
    if (!isPosition(position) || !isNonNegativeInteger(delay)) return false;
    this.timeline.positions.push(position);
    this.timeline.delays.push(delay);
    return true;
  }

  destroy(): void {
    this.playing = false;
    this.cancelTimer();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private readonly tick = () => {
    if (!this.playing) return;
    this.update(performance.now());
    if (this.playing) this.timer = window.setTimeout(this.tick, TICK_MILLIS);
  };

  private update(now: number): void {
    this.elapsedMillis = Math.max(0, now - this.segmentStartedAt);
    let delayMillis = this.delayMillis();

    while (this.playing && this.elapsedMillis >= delayMillis) {
      const overrun = this.elapsedMillis - delayMillis;
      this.position += 1;
      this.elapsedMillis = 0;
      this.adapter.goToPosition(this.position);
      this.renderExact();

      if (!this.hasNext()) {
        this.playing = false;
        this.cancelTimer();
        this.adapter.stateChanged?.(false);
        this.adapter.ended?.();
        return;
      }

      this.elapsedMillis = overrun;
      this.segmentStartedAt = now - overrun;
      delayMillis = this.delayMillis();
    }

    if (this.playing) this.adapter.renderClock(this.frame(this.elapsedMillis, this.nextMover()));
  }

  private readonly delayMillis = (): number => Math.max(0, this.timeline.delays[this.position] * 10);

  private readonly nextMover = (): Color =>
    (this.timeline.startPly + this.position) % 2 === 0 ? 'white' : 'black';

  private frame(elapsed: number, activeColor: Color | undefined): RecordedClockFrame {
    const position = this.timeline.positions[this.position];
    const frame: RecordedClockFrame = {
      white: position.white * 10,
      black: position.black * 10,
      activeColor,
    };
    if (activeColor) frame[activeColor] = Math.max(0, frame[activeColor] - elapsed);
    return frame;
  }

  private renderExact(): void {
    this.adapter.renderClock(this.frame(0, undefined));
  }

  private clampPosition(position: number): number {
    return Math.max(0, Math.min(this.timeline.positions.length - 1, Math.trunc(position)));
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

export function isRecordedClockTimeline(value: unknown): value is RecordedClockTimeline {
  if (!isRecord(value) || !isNonNegativeInteger(value.startPly)) return false;
  if (!Array.isArray(value.positions) || !Array.isArray(value.delays) || value.positions.length < 2)
    return false;
  if (value.positions.length !== value.delays.length + 1) return false;
  return value.positions.every(isPosition) && value.delays.every(isNonNegativeInteger);
}

function isPosition(value: unknown): value is RecordedClockPosition {
  return isRecord(value) && isNonNegativeInteger(value.white) && isNonNegativeInteger(value.black);
}

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
