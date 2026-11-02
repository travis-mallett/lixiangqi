import type { BoardPreferences } from 'lib/board';

export type Color = 'black' | 'green' | 'red';
export const colors: readonly Color[] = ['black', 'green', 'red'];
export interface Piece {
  location: string;
  army: Color;
  role: string;
  controller: Color | null;
  fallen?: boolean;
}
export interface State {
  position: string;
  noSafeEscape?: boolean;
  perpetualWarning?: boolean;
  checkSources?: Partial<Record<Color, Color[]>>;
  turn: Color;
  active: Color[];
  controllers: (Color | null)[];
  pieces: Piece[];
  ply: number;
  moves: string[];
  checked: Color[];
  lastMove: string | null;
  eliminated: { player: Color; reason: string; ply: number }[];
  ending: { reason: string; winners: Color[]; draw: boolean } | null;
}
export interface EngineLine {
  scores: number[];
  pvMoves: string[];
  active: Color[];
  winners: Color[] | null;
}
export interface EngineResult {
  lines: EngineLine[];
  depth: number;
  nodes: number;
}
export interface SearchOptions {
  depth: number;
  nodes: number;
  multiPv?: number;
  emit?: (result: EngineResult, final: boolean) => void;
}
export interface Rules {
  initial(): string;
  inspect(position: string): State;
  play(position: string, move: string): string;
  withdraw(position: string, player: string): string;
  event(position: string, actor: string, action: string): string;
  edit(position: string, pieces: string, turn: string): string;
  notation(position: string, move: string): string;
  coordinate(location: string): string;
  route(position: string, move: string): string[];
}
export interface RecordedAction {
  action: string;
  actor: Color;
  at: number;
  clocks: number[];
}
export interface Game {
  id: string;
  variant: 'threeKingdoms';
  rules: 'threeKingdoms-v1';
  revision: number;
  eventCount: number;
  position: string;
  initial: string;
  rated: boolean;
  source: string;
  tournamentId?: string | null;
  createdAt: number;
  serverTime: number;
  clock: {
    remaining: number[];
    startedAt: number;
    initialSeconds: number;
    moveSeconds: number;
    deadline: number | null;
  };
  seats: {
    color: Color;
    kingdom: string;
    aiLevel: number | null;
    guest?: boolean;
    user: { id: string; name: string } | null;
    rank: string | null;
    place: number | null;
    eliminated: boolean;
  }[];
  events: RecordedAction[];
  drawOffers: Color[];
  takebackOffers: Color[];
  finished: boolean;
}
export interface Challenge {
  id: string;
  creator: string;
  users: string[];
  accepted: string[];
  expiresAt: number;
  status: string;
  initialSeconds: number;
  moveSeconds: number;
}
export interface Bootstrap {
  mode: string;
  me: string | null;
  game?: Game;
  challenge?: Challenge;
  user?: string;
  preferences: BoardPreferences;
}
