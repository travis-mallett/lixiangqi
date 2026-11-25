import { jieqiEngines, type JieqiEngineId } from 'lib/ceval/engines/jieqiEngines';
import { banqiEngineName } from 'lib/game/aiLevel';

import type { ArrowBudget } from './analysisArrowCadence';
import type { EngineSettings } from './analysisSettings';

export interface AnalysisEngineConfig {
  variant: 'banqi' | 'xiangqi' | 'jieqi' | 'minixiangqi' | 'manchu';
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
  const banqi = variant === 'banqi';
  const jieqi = variant === 'jieqi';
  const mini = variant === 'minixiangqi';
  const fairy = mini || variant === 'manchu';
  return {
    variant: banqi
      ? 'banqi'
      : jieqi
        ? 'jieqi'
        : mini
          ? 'minixiangqi'
          : variant === 'manchu'
            ? 'manchu'
            : 'xiangqi',
    name: banqi
      ? banqiEngineName
      : jieqi
        ? jieqiEngines[selected].name
        : fairy
          ? 'Fairy-Stockfish'
          : 'Pikafish',
    candidateMoves: jieqi || banqi,
    maxMultiPv: jieqi ? jieqiEngines[selected].multiPv : 5,
    hiddenSettings: banqi
      ? ['use-cloud', 'threads', 'lines-preview', 'depth', 'hash-size']
      : jieqi
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
