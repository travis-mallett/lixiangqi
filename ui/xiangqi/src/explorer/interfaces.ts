export type ExplorerDb = 'masters' | 'lixiangqi' | 'player';
export type ExplorerColor = 'red' | 'black';

export interface ExplorerPlayer {
  name: string;
  nativeName: string;
  romanizedName?: string;
  romanization?: string;
  rating?: number;
  entry?: string;
  team?: string;
  country?: string;
  level?: string;
  sourceEnglishName?: string;
  recordedTime?: string;
}

export interface ExplorerGameMetadata {
  title?: string;
  event?: string;
  class?: string;
  group?: string;
  place?: string;
  round?: string;
  table?: string;
  gameType?: string;
  timeRule?: string;
  opening?: string;
  endType?: string;
  judge?: string;
  record?: string;
  remark?: string;
  author?: string;
  reference?: string;
  other?: string;
  addedAt?: string;
  editedAt?: string;
  comments?: Record<string, string>;
}

export interface ExplorerGame {
  id: string;
  move: string;
  moves: string[];
  notations: string[];
  red: ExplorerPlayer;
  black: ExplorerPlayer;
  winner?: ExplorerColor;
  year?: number;
  month?: string;
  event?: string;
  metadata?: ExplorerGameMetadata;
  sourceUrl: string;
}

export interface ExplorerMove {
  move: string;
  notation: string;
  red: number;
  draws: number;
  black: number;
  games: number;
}

export interface ExplorerData {
  available: boolean;
  database: ExplorerDb;
  source: string;
  sourceUrl: string;
  fen: string;
  red: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  topGames: ExplorerGame[];
  recentGames: ExplorerGame[];
  error?: string;
}

export interface ExplorerConfig {
  db: ExplorerDb;
  since: string;
  until: string;
  player: string;
  color: ExplorerColor;
}

export interface ExplorerPosition {
  fen: string;
}
