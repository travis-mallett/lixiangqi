export const catalogSources = ['m', 'n', 't', 'k', 'o', 'b', 'u', 'w', 'gd', 'xqd'] as const;

export type CatalogSource = (typeof catalogSources)[number];
export type CatalogCountSource = CatalogSource | 'online';
export type CatalogSort = 'source' | 'date' | 'red' | 'black' | 'result' | 'event' | 'round' | 'moves';
export type CatalogDirection = 'asc' | 'desc';

export interface CatalogPlayer {
  name: string;
  nativeName?: string;
  romanizedName?: string;
  rating?: number;
  country?: string;
}

export interface CatalogGame {
  id: string;
  sources: Array<{
    id: CatalogSource;
    name: string;
    externalId: string;
    url: string;
  }>;
  red: CatalogPlayer;
  black: CatalogPlayer;
  result: number;
  playedAt?: string;
  year?: number;
  event?: string;
  round?: string;
  moves: number;
}

export interface CatalogResult {
  available: boolean;
  total: number;
  page: number;
  pageSize: number;
  games: CatalogGame[];
  sourceCounts: Record<CatalogCountSource, number>;
  error?: string;
}

export const sourceLabels: Record<CatalogSource, string> = {
  m: 'Master Games',
  n: 'Online Tournaments',
  t: 'Top Games',
  k: 'Top Blitz Games',
  o: 'Other Games',
  b: 'Under 24 Moves',
  u: 'Player Uploads',
  w: 'Unassigned Games',
  gd: 'GDChess/01xq',
  xqd: 'XQDao',
};

export function isCatalogSource(value: string): value is CatalogSource {
  return catalogSources.includes(value as CatalogSource);
}

export function countedSourceLabel(label: string, count: number): string {
  return `${label} (${count.toLocaleString('en-US')})`;
}

export function analysisGameUrl(gameId: string): string {
  return `/analysis?game=${encodeURIComponent(gameId)}`;
}

export function resultLabel(result: number): string {
  if (result > 0) return '1-0';
  if (result < 0) return '0-1';
  return '½-½';
}
