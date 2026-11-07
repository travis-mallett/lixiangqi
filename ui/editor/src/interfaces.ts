import type { VisiblePiece } from '@lixiangqi/board';

export type Color = 'red' | 'black' | 'green';
export type EditorVariant = 'xiangqi' | 'jieqi' | 'minixiangqi' | 'manchu' | 'threeKingdoms';

export type Redraw = () => void;
export type Selected = 'pointer' | 'trash' | VisiblePiece;

export interface EditorState {
  fen: string;
  legalFen?: string;
  playable: boolean;
  validating: boolean;
  error?: 'invalid' | 'unavailable';
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
  variant?: EditorVariant;
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
