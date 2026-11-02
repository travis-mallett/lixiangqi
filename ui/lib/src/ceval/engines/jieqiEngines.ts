export const defaultJieqiEngine = 'abjchess';

export const jieqiEngines = {
  abjchess: {
    name: 'AB-JChess · NNUE',
    file: 'abjchess/abjchess',
    prefix: 'abjchess',
    network: 'abjchess/abjchess-20261030.nnue',
    multiPv: 1,
  },
  jqe: { name: 'jqe · NNUE', file: 'jqe/jqe', prefix: 'jqe', network: 'jqe/it014.jqn', multiPv: 1 },
  pikajieqi: { name: 'PikaJieQi', file: 'pikajieqi', prefix: 'pikajieqi', network: undefined, multiPv: 5 },
} as const;

export type JieqiEngineId = keyof typeof jieqiEngines;

export function jieqiEngineId(value: unknown): JieqiEngineId {
  return value === 'pikajieqi' || value === 'jqe' ? value : defaultJieqiEngine;
}
