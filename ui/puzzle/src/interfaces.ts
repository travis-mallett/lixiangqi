import type { RulesState } from 'xiangqi';

import type { XiangqiNotationStyle } from 'lib/game';
import perfIcons from 'lib/game/perfIcons';
import type { Coords, MoveEvent } from 'lib/prefs';
import type { TreePath } from 'lib/tree/types';

import type { PuzzlePlayback } from './solutions';
import type { PuzzleVariant } from './variant';

export type PuzzleId = string;
export type ThemeKey = keyof I18n['puzzleTheme'] | 'centroidPawnMate';

export type ReplayEnd = PuzzleReplay;

export type PuzzleDifficulty = 'easiest' | 'easier' | 'normal' | 'harder' | 'hardest';

export interface PuzzleSettings {
  difficulty: PuzzleDifficulty;
  color?: Color;
}

export interface PuzzleOpts {
  pref: PuzzlePrefs;
  data: PuzzleData;
  settings: PuzzleSettings;
  themes?: {
    dynamic: string;
    static: string;
  };
  showRatings: boolean;
}

export interface PuzzlePrefs {
  coords: Coords;
  destination: boolean;
  rookCastle: boolean;
  moveEvent: MoveEvent;
  highlight: boolean;
  animation: {
    duration: number;
  };
  blindfold: boolean;
  notationStyle: XiangqiNotationStyle;
}

export interface Angle {
  key: ThemeKey;
  name: string;
  desc: string;
  icon: string;
  chapter?: string;
}

export interface PuzzleData {
  variant: PuzzleVariant;
  puzzle: Puzzle;
  angle: Angle;
  game: PuzzleGame;
  user?: PuzzleUser;
  replay?: PuzzleReplay;
  streak?: string;
  isDaily?: boolean;
}

export interface PuzzleReplay {
  i: number;
  of: number;
  days: number;
}

export interface PuzzleGame {
  id: string;
  url?: string;
  event?: string;
  sourceUrl?: string;
  perf?: {
    key: keyof typeof perfIcons;
    name: string;
  };
  rated: boolean;
  players: [PuzzlePlayer, PuzzlePlayer];
  clock?: string;
  moveTime?: import('lib/game').MoveTimeLimit;
  initialFen?: string;
  moves?: string[];
  notations?: string[];
  notationsZh?: string[];
}

export interface PuzzlePlayer {
  name: string;
  rating?: number;
  title?: string;
  flair?: string;
  url?: string;
  color: Color;
}

export interface PuzzleUser {
  rating: number;
  provisional?: boolean;
}

export interface Puzzle {
  id: PuzzleId;
  playback: PuzzlePlayback;
  rating: number;
  plays: number;
  initialPly: number;
  themes: ThemeKey[];
  state?: RulesState;
  displayFen?: string;
}

export interface PuzzleResult {
  round?: PuzzleRound;
  next?: PuzzleData;
  replayComplete?: boolean;
}

export type RoundThemes = Record<ThemeKey, boolean | undefined>;

export interface PuzzleRound {
  win: boolean;
  ratingDiff: number;
  themes?: RoundThemes;
}

export interface XiangqiMoveTest {
  uci: string;
  path: TreePath;
}
