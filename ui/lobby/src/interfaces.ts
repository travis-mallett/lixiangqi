import type { ColorChoice } from 'lib/setup/color';
import type { ClockConfig, MoveTimeLimitConfig } from 'lib/setup/interfaces';
import type { TimeMode } from 'lib/setup/timeControl';

export type Tab = 'pools' | 'real_time' | 'seeks' | 'now_playing';
export type GameType = 'hook' | 'friend' | 'ai';
export type SetupVariant = VariantKey | 'threeKingdoms';

export interface Variant {
  id: number;
  key: SetupVariant;
  name: string;
}

export interface Hook {
  id: string;
  sri: string;
  clock: string;
  t: number; // time
  i: number; // increment
  moveTime?: MoveTimeLimitConfig;
  variant: VariantKey;
  perf: string;
  u?: string; // username
  rank?: string;
  action: 'cancel' | 'join';
  disabled?: boolean;
}

export interface Seek {
  id: string;
  username: string;
  rank: string;
  days?: number;
  perf: {
    key: string;
  };
  variant?: { key: VariantKey };
  action: 'joinSeek' | 'cancelSeek';
}

export interface Pool extends ClockConfig {
  id: PoolId;
  name: string;
  ranked: boolean;
  rankTrack?: string;
}

export interface HomepageRoom {
  pool: Pool;
  liveGamesHtml: string;
}

export interface LobbyOpts {
  appElement: HTMLElement;
  tableElement: HTMLElement;
  socketSend: SocketSend;
  pools: Pool[];
  homePools: Pool[];
  hasUnreadLichessMessage: boolean;
  playban: boolean;
  data: LobbyData;
  bots?: boolean;
}

export interface LobbyMe {
  isBot: boolean;
  username: string;
}

export interface LobbyData {
  hooks: Hook[];
  seeks: Seek[];
  me?: LobbyMe;
  nbNowPlaying: number;
  nbMyTurn: number;
  nowPlaying: NowPlaying[];
  kingdomsPlaying?: KingdomsPlaying[];
  counters: { members: number; rounds: number };
  stats?: { gamesPlayedToday: number; registeredUsers: number; gamesPlayedAllTime: number };
  poolCounts: Record<string, number>;
}

export interface KingdomsPlaying {
  gameId: string;
  position: string;
  players: string[];
  isMyTurn: boolean;
  hasBots: boolean;
}

export interface NowPlaying {
  fullId: string;
  gameId: string;
  fen: FEN;
  color: Color;
  orientation?: Color;
  lastMove: string;
  variant: {
    key: string;
    name: string;
  };
  speed: string;
  perf: string;
  ranked: boolean;
  hasMoved: boolean;
  opponent: {
    id: string;
    username: string;
    rank?: string;
    ai?: number;
  };
  isMyTurn: boolean;
  secondsLeft?: number;
}

export interface PoolMember {
  id: PoolId;
  blocking?: string;
}

export type PoolId = string;
export interface SetupStore {
  fen: FEN;
  timeMode: TimeMode;
  color: ColorChoice;
  aiLevel: number;
  aiTimeControls?: boolean;
  time: number;
  increment: number;
  days: number;
  moveTime?: MoveTimeLimitConfig;
}

export interface AiStatsCounts {
  wins: number;
  draws: number;
  losses: number;
  games: number;
}

export interface AiLevelStats {
  level: number;
  registered: AiStatsCounts;
  mine?: AiStatsCounts;
}

export interface AiStatsResponse {
  levels: AiLevelStats[];
}

export interface ForceSetupOptions {
  variant?: SetupVariant;
  fen?: FEN;
  timeMode?: TimeMode;
  time?: number;
  increment?: number;
  days?: number;
  moveTime?: MoveTimeLimitConfig;
  color?: ColorChoice;
}
