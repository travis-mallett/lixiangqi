import { jieqiEngines, type JieqiEngineId } from 'lib/ceval/engines/jieqiEngines';

import type { ArrowBudget } from './analysisArrowCadence';
import type { EngineSettings } from './analysisSettings';

export interface AnalysisEngineConfig {
  variant: 'xiangqi' | 'jieqi' | 'minixiangqi';
  name: string;
  candidateMoves: boolean;
  maxMultiPv: number;
  hiddenSettings: string[];
  search(settings: EngineSettings, line?: boolean): { depth: number };
  arrowBudget(settings: EngineSettings, line?: boolean): ArrowBudget;
  threads(settings: EngineSettings): number;
}

/** Capabilities of the engine builds shipped with the analysis board. */
export function analysisEngineConfig(
  variant?: string,
  selected: JieqiEngineId = 'abjchess',
): AnalysisEngineConfig {
  const jieqi = variant === 'jieqi';
  const mini = variant === 'minixiangqi';
  return {
    variant: jieqi ? 'jieqi' : mini ? 'minixiangqi' : 'xiangqi',
    name: jieqi ? jieqiEngines[selected].name : mini ? 'Fairy-Stockfish' : 'Pikafish',
    candidateMoves: jieqi,
    maxMultiPv: jieqi ? jieqiEngines[selected].multiPv : 5,
    hiddenSettings: jieqi
      ? [
          'use-cloud',
          'threads',
          'lines-preview',
          ...(jieqiEngines[selected].multiPv === 1 ? ['multipv'] : []),
        ]
      : mini
        ? ['use-cloud']
        : [],
    search: (settings: EngineSettings, line = false) => ({
      depth: line ? Math.min(settings.depth, 18) : settings.depth,
    }),
    arrowBudget: (settings: EngineSettings, line = false) =>
      line ? Math.min(settings.depth, 18) : settings.depth,
    threads: (settings: EngineSettings) => (jieqi ? 1 : settings.threads),
  };
}
