import type { VisiblePiece } from '@lixiangqi/board';

import type { XiangqiSide as Color } from 'lib/game/xiangqi';

export type Redraw = () => void;
export type Selected = 'pointer' | 'trash' | Extract<VisiblePiece, { face: 'up' }>;

export interface EditorState {
  fen: string;
  legalFen?: string;
  playable: boolean;
  validating: boolean;
}

export interface XiangqiEditor {
  getFen(): string;
  setFen(fen: string): boolean;
  setOrientation(orientation: Color): void;
  destroy(): void;
}

export interface Config {
  el?: HTMLElement;
  baseUrl: string;
  startFen: string;
  fen?: string;
  options?: Options;
  animation: {
    duration: number;
  };
  embed?: boolean;
}

export interface Options {
  orientation?: Color;
  onChange?: (fen: string) => void;
  coordinates?: boolean;
  bindHotkeys?: boolean;
}
