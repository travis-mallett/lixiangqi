import type { VNode } from 'lib/view';

import type { DasherCtrl } from '@/ctrl';
import type { LangsData } from '@/langs';

export abstract class PaneCtrl {
  constructor(readonly root: DasherCtrl) {}
  get redraw(): Redraw {
    return this.root.redraw;
  }
  get close(): () => void {
    return this.root.close;
  }
  abstract render(): VNode;
}

export interface CatalogItem {
  key: string;
  name: string;
}

export interface MusicSetData extends CatalogItem {
  attribution: string;
}

export interface UiThemeData extends CatalogItem {
  colorScheme: 'light' | 'dark';
  previewBackground: string;
  previewPanel: string;
  previewPanelLow: string;
  previewAccent: string;
}

export interface BackgroundData extends CatalogItem {
  image?: string | null;
}

export interface BoardThemeData extends CatalogItem {
  file: string;
  coordinateLight: string;
  coordinateDark: string;
}

export interface PieceSetData extends CatalogItem {
  category: 'traditional' | 'graphicalSymbols' | 'other';
  assets: Record<string, string>;
}

export interface BoardSettings {
  brightness: number;
  contrast: number;
  saturation: number;
  opacity: number;
  hue: number;
}

export interface AppearanceState {
  uiTheme: string;
  background: string;
  backgroundUrl?: string | null;
  boardTheme: string;
  pieceSet: string;
  soundSet: string;
  musicSet: string;
  board: BoardSettings;
}

export interface AppearanceData {
  current: AppearanceState;
  uiThemes: UiThemeData[];
  backgrounds: BackgroundData[];
  boards: BoardThemeData[];
  pieceSets: PieceSetData[];
  soundSets: CatalogItem[];
  musicSets: MusicSetData[];
}

export interface DasherData {
  user?: LightUser;
  lang: LangsData;
  appearance: AppearanceData;
  coach: boolean;
  streamer: boolean;
}

export type Mode = 'links' | 'langs' | 'sound' | 'uiTheme' | 'boardStyle' | 'boardPieces';

export interface DasherOpts {
  playing: boolean;
  zenable: boolean;
}
