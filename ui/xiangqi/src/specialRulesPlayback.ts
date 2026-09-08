import type { AdjudicationPosition } from 'lib/game/view/adjudication';

import type { RulesState } from './tree';

export interface ExamplePlayback {
  ruleset: string;
  state: RulesState & AdjudicationPosition;
  acceptedPly: number;
  lastMove?: string;
  rejected?: { ply: number; move: string; error: string } | null;
  script: { move: string; english: string; chinese: string }[];
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
