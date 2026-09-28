export interface AttentionState {
  visible: boolean;
  ownsAttention: boolean;
  board: boolean;
  solving: boolean;
  musicEnabled: boolean;
  effectsEnabled: boolean;
  musicPlaying: boolean;
}

export const idleAfter = 120_000;

/** A monotonic clock, with sleep gaps discarded and engagement bounded by the last interaction. */
export class AttentionClock {
  private previous: number;
  private interaction: number;

  constructor(now: number) {
    this.previous = now;
    this.interaction = now;
  }

  interact(now: number): void {
    this.interaction = now;
  }

  read(now: number, state: AttentionState): Record<string, number> {
    const start = this.previous;
    this.previous = now;
    const elapsed = now - start;
    if (!state.visible || elapsed < 0 || elapsed > 15_000) return {};
    const visibleMs = Math.floor(elapsed);
    const engagedMs = state.ownsAttention
      ? Math.floor(Math.max(0, Math.min(now, this.interaction + idleAfter) - start))
      : 0;
    return {
      visibleMs,
      engagedMs,
      boardMs: state.board ? engagedMs : 0,
      solvingMs: state.solving ? engagedMs : 0,
      musicEnabledMs: state.musicEnabled ? engagedMs : 0,
      effectsEnabledMs: state.effectsEnabled ? engagedMs : 0,
      musicPlayingMs: state.musicPlaying ? engagedMs : 0,
    };
  }
}
