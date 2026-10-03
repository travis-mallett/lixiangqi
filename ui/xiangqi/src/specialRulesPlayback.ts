import type { AdjudicationPosition } from 'lib/game/view/adjudication';
import type { RulesState } from 'lib/tree/native';

export interface ExamplePlayback {
  ruleset: string;
  state: RulesState & AdjudicationPosition;
  acceptedPly: number;
  lastMove?: string;
  rejected?: { ply: number; move: string; error: string } | null;
  script: { move: string; english: string; chinese: string }[];
}

/** A fixed, server-validated line. Its states and notation are shared by all readers. */
export interface ExampleSequence {
  ruleset: string;
  states: ExamplePlayback['state'][];
  script: ExamplePlayback['script'];
}

export function examplePosition(sequence: ExampleSequence, ply: number): ExamplePlayback {
  if (!Number.isInteger(ply) || ply < 0 || ply > sequence.script.length || !sequence.states[ply])
    throw new Error('Invalid example move index');
  return {
    ruleset: sequence.ruleset,
    state: sequence.states[ply],
    acceptedPly: ply,
    lastMove: ply ? sequence.script[ply - 1].move : undefined,
    script: sequence.script,
  };
}

/** Navigation requests authoritative history; no rule thresholds or predicted outcomes live here. */
export class SpecialRulesPlayback {
  data?: ExamplePlayback;
  pending = false;
  error?: string;

  constructor(
    private readonly request: (ply: number) => Promise<ExamplePlayback>,
    private readonly changed: () => void,
  ) {}

  async go(ply: number): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    this.error = undefined;
    this.changed();
    try {
      this.data = await this.request(ply);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.pending = false;
      this.changed();
    }
  }

  previous(): number {
    // First step back dismisses the rejected attempt while retaining the last legal position.
    return this.data?.rejected ? this.data.acceptedPly : Math.max(0, (this.data?.acceptedPly ?? 0) - 1);
  }
}
