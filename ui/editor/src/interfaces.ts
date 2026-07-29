import type { Color, Role } from 'chessgroundx/types';

export type Redraw = () => void;
export type Selected = 'pointer' | 'trash' | { color: Color; role: Role };

export interface EditorState {
  fen: string;
  legalFen?: string;
  playable: boolean;
  validating: boolean;
}

export interface LichessEditor {
  getFen(): string;
  setFen(fen: string): boolean;
  setOrientation(orientation: Color): void;
  setVariant(variant: string): void;
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
