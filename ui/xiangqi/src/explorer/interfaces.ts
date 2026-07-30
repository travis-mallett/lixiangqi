export type ExplorerDb = 'masters' | 'all' | 'dpxq' | 'gdchess' | 'xqdao' | 'player' | 'event';
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
  initialFen?: string;
  notation?: string;
  recordKind?: string;
  statisticalEligible?: boolean;
  witnesses?: ExplorerWitness[];
}

export interface ExplorerAnnotation {
  anchor: 'record' | 'root' | 'move' | 'position' | 'variation';
  ply?: number;
  path?: string;
  type: string;
  body: string;
  sourceKey?: string;
  ordinal?: number;
  translationOf?: number;
  supersedes?: number;
}

export interface ExplorerWitness {
  id: number;
  source: string;
  collection: string;
  collectionName: string;
  externalId: string;
  url: string;
  editionId?: string;
  metadata?: Record<string, unknown>;
  parserVersion?: string;
  rawChecksum?: string;
  acquiredAt?: string;
  locator?: Record<string, unknown>;
  matchMethod?: string;
  matchConfidence?: number;
  mainlineHash?: string;
  notation?: string;
  annotations: Array<{
    id: number;
    kind: string;
    annotator?: string;
    language?: string;
    engine?: string;
    engineVersion?: string;
    createdAt?: string;
    license?: string;
    metadata?: Record<string, unknown>;
    annotations: ExplorerAnnotation[];
    series: Array<{
      type: string;
      values: unknown[];
      moves: string[];
      metadata: Record<string, unknown>;
    }>;
  }>;
  treeNodes: Array<{
    id: number;
    parentId?: number;
    path: string;
    ply: number;
    move: string;
    notation: string;
    positionKey: string;
    isMainline: boolean;
    order: number;
    canonicalPly?: number;
  }>;
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
  event: string;
  color: ExplorerColor;
}

export interface ExplorerPosition {
  fen: string;
}
