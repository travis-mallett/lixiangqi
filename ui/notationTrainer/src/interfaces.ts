export type TimeControl = 'untimed' | 'thirtySeconds';

export type Mode = 'moveFromNotation' | 'writeNotation';

export type NotationSystem = 'wxf' | 'chinese';

export type BoardPerspective = 'red' | 'black' | 'both';

export type MoveSide = 'red' | 'black' | 'both';

interface PerspectiveScores {
  red: number[];
  black: number[];
  both: number[];
}

export interface ModeScores {
  moveFromNotation: PerspectiveScores;
  writeNotation: PerspectiveScores;
}

export interface NotationExercise {
  fen: string;
  turn: 'red' | 'black';
  legalMoves: string[];
  move: string;
  resultFen: string;
  wxf: string;
  chinese: string;
}

export interface NotationTrainerConfig {
  notationSystem: NotationSystem;
  scores: ModeScores;
}

export type Redraw = () => void;
