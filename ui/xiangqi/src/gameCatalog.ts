export const catalogSources = ['m', 'am', 'n', 't', 'k', 'o', 'b', 'u', 'w', 'gd', 'xqd', 'ec'] as const;

export type CatalogSource = (typeof catalogSources)[number];
export type CatalogCountSource = CatalogSource | 'online';
export type CatalogSort = 'source' | 'date' | 'red' | 'black' | 'result' | 'event' | 'round' | 'moves';
export type CatalogDirection = 'asc' | 'desc';
export type CatalogTimelineUnit = 'month' | 'year' | 'decade';

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
  playerColor?: 'red' | 'black';
}

export interface CatalogResult {
  available: boolean;
  total: number;
  page: number;
  pageSize: number;
  games: CatalogGame[];
  totalUniqueGames: number;
  sourceCounts: Record<CatalogCountSource, number>;
  timeline: {
    unit: CatalogTimelineUnit;
    buckets: Array<{
      start: string;
      count: number;
    }>;
    undated: number;
  };
  weeklyAdded: {
    count: number;
    startsAt: string;
    endsAt: string;
    timeZone: string;
  };
  error?: string;
}

export interface PlayerOutcome {
  games: number;
  wins: number;
  draws: number;
  losses: number;
}

export interface PlayerDatabaseIdentity {
  query: string;
  name: string;
  nativeName: string;
  romanizedName?: string;
  key: string;
}

export interface PlayerDatabaseSummary {
  totalGames: number;
  firstPlayedAt?: string | null;
  lastPlayedAt?: string | null;
  opponents: number;
  events: number;
  averageMoves?: number | null;
  averageRating?: number | null;
  overall: PlayerOutcome;
  red: PlayerOutcome;
  black: PlayerOutcome;
  topOpponents: Array<
    CatalogPlayer & {
      games: number;
      wins: number;
      draws: number;
      losses: number;
    }
  >;
  topOpenings: Array<{
    name: string;
    games: number;
  }>;
}

export interface PlayerDatabaseResult {
  available: boolean;
  player?: PlayerDatabaseIdentity;
  summary?: PlayerDatabaseSummary | null;
  total: number;
  page: number;
  pageSize: number;
  games: CatalogGame[];
  sourceCounts: Record<CatalogCountSource, number>;
  timeline: CatalogResult['timeline'];
  error?: string;
}

export interface EventStanding extends CatalogPlayer {
  rank: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  score: number;
  redGames: number;
  blackGames: number;
  averageRating?: number | null;
}

export interface EventDatabaseSummary {
  totalGames: number;
  firstPlayedAt?: string | null;
  lastPlayedAt?: string | null;
  players: number;
  rounds: number;
  averageMoves?: number | null;
  recordedOpenings: number;
  redWins: number;
  draws: number;
  blackWins: number;
  standings: EventStanding[];
  topOpenings: Array<{
    name: string;
    games: number;
  }>;
  places: Array<{
    name: string;
    games: number;
  }>;
}

export interface EventDatabaseRound {
  name: string;
  dates: string[];
  games: CatalogGame[];
}

export interface EventDatabaseResult {
  available: boolean;
  event?: {
    query: string;
    name: string;
  };
  summary?: EventDatabaseSummary | null;
  rounds: EventDatabaseRound[];
  sourceCounts: Record<CatalogCountSource, number>;
  error?: string;
}

export const sourceLabels: Record<CatalogSource, string> = {
  m: 'Master Games',
  am: 'Ancient Manuals',
  n: 'Online Tournaments',
  t: 'Top Games',
  k: 'Top Blitz Games',
  o: 'Other Games',
  b: 'Under 24 Moves',
  u: 'Player Uploads',
  w: 'Unassigned Games',
  gd: 'GDChess/01xq',
  xqd: 'XQDao',
  ec: 'Elephantchess.io',
};

export function isCatalogSource(value: string): value is CatalogSource {
  return catalogSources.includes(value as CatalogSource);
}

/** A catalog date can know only a year or month. Never let Date normalize unknown components. */
export function formatRecordedDate(value?: string | null, locale?: string): string {
  if (!value) return '—';
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:$|[ T])/.exec(value);
  if (!match) return value;
  const year = Number(match[1]);
  const month = Number(match[2] ?? 0);
  const day = Number(match[3] ?? 0);
  if (!year) return '—';
  if (!month) return String(year);
  if (month > 12) return value;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day || 1);
  if (date.getUTCMonth() !== month - 1) return value;
  return new Intl.DateTimeFormat(locale ?? (document.documentElement.lang || undefined), {
    calendar: 'gregory',
    ...(day ? { day: 'numeric' as const } : {}),
    month: day ? 'short' : 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function countedSourceLabel(label: string, count: number): string {
  return `${label} (${count.toLocaleString('en-US')})`;
}

export function sortSourceKeysByCount<T extends string>(
  keys: readonly T[],
  counts: Readonly<Partial<Record<T, number>>>,
): T[] {
  const originalPosition = new Map(keys.map((key, index) => [key, index]));
  return [...keys].sort(
    (left, right) =>
      (counts[right] ?? 0) - (counts[left] ?? 0) ||
      (originalPosition.get(left) ?? 0) - (originalPosition.get(right) ?? 0),
  );
}

export function analysisGameUrl(gameId: string): string {
  return `/analysis?game=${encodeURIComponent(gameId)}`;
}

export function annotationSourceLabel(collection: string, collectionName: string): string | undefined {
  return collection === 'ancient_manuals' ? undefined : collectionName;
}

export function databasePlayerUrl(player: string): string {
  return `/games/database/player?player=${encodeURIComponent(player)}`;
}

export function databaseEventUrl(event: string): string {
  return `/games/database/event?event=${encodeURIComponent(event)}`;
}

export function resultLabel(result: number): string {
  if (result > 0) return '1-0';
  if (result < 0) return '0-1';
  return '½-½';
}
