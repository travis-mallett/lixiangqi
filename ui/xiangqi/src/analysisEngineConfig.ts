import { jieqiEngines, type JieqiEngineId } from 'lib/ceval/engines/jieqiEngines';

import type { ArrowBudget } from './analysisArrowCadence';
import type { EngineSettings } from './analysisSettings';

export interface AnalysisEngineConfig {
  variant: 'xiangqi' | 'jieqi' | 'minixiangqi' | 'manchu';
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
  const fairy = mini || variant === 'manchu';
  return {
    variant: jieqi ? 'jieqi' : mini ? 'minixiangqi' : variant === 'manchu' ? 'manchu' : 'xiangqi',
    name: jieqi ? jieqiEngines[selected].name : fairy ? 'Fairy-Stockfish' : 'Pikafish',
    candidateMoves: jieqi,
    maxMultiPv: jieqi ? jieqiEngines[selected].multiPv : 5,
    hiddenSettings: jieqi
      ? [
          'use-cloud',
          'threads',
          'lines-preview',
          ...(jieqiEngines[selected].multiPv === 1 ? ['multipv'] : []),
        ]
      : fairy
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
