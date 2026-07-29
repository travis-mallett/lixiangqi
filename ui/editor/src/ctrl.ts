import type { Api } from 'chessgroundx/api';
import { read as readFen } from 'chessgroundx/fen';
import type { Color } from 'chessgroundx/types';

import * as xhr from 'lib/xhr';

import type { Config, EditorState, Redraw, Selected } from './interfaces';

const DIMENSIONS = { width: 9, height: 10 } as const;

interface PositionResponse {
  fen: string;
  gameResult: string;
  legalMoves: string[];
}

export default class EditorCtrl {
  ground?: Api;
  selected: Selected = 'pointer';
  orientation: Color;
  turn: Color;
  halfmoves = 0;
  fullmoves = 1;
  state: EditorState;
  private validation = 0;

  constructor(
    readonly cfg: Config,
    readonly redraw: Redraw,
  ) {
    this.orientation = cfg.options?.orientation ?? 'white';
    const fen = normalizeFen(cfg.fen ?? cfg.startFen, cfg.startFen);
    const fields = fen.split(/\s+/);
    this.turn = fields[1] === 'b' ? 'black' : 'white';
    this.halfmoves = nonNegativeInt(fields[4], 0);
    this.fullmoves = Math.max(1, nonNegativeInt(fields[5], 1));
    this.state = { fen, validating: true, playable: false };
  }

  attachGround(ground: Api): void {
    this.ground = ground;
    void this.validate();
  }

  getFen(): string {
    const placement = this.ground?.getFen() ?? this.state.fen.split(/\s+/)[0];
    return `${placement} ${this.turn === 'white' ? 'w' : 'b'} - - ${this.halfmoves} ${this.fullmoves}`;
  }

  setFen(rawFen: string): boolean {
    const fen = normalizeFen(rawFen, '');
    if (!fen || !hasBoardShape(fen)) return false;
    const fields = fen.split(/\s+/);
    this.turn = fields[1] === 'b' ? 'black' : 'white';
    this.halfmoves = nonNegativeInt(fields[4], 0);
    this.fullmoves = Math.max(1, nonNegativeInt(fields[5], 1));
    this.state = { fen, validating: true, playable: false };
    this.ground?.set({ fen: fields[0], turnColor: this.turn });
    this.changed();
    return true;
  }

  startPosition(): void {
    this.setFen(this.cfg.startFen);
  }

  clearBoard(): void {
    this.setFen(`9/9/9/9/9/9/9/9/9/9 ${this.turn === 'white' ? 'w' : 'b'} - - 0 1`);
  }

  flip(): void {
    this.ground?.toggleOrientation();
    this.orientation = this.orientation === 'white' ? 'black' : 'white';
    this.changed(false);
  }

  setOrientation(orientation: Color): void {
    if (orientation !== this.orientation) this.ground?.toggleOrientation();
    this.orientation = orientation;
    this.changed(false);
  }

  setVariant(_variant: string): void {
    // Xiangqi is the sole game. Retain the editor API method for native
    // embedding callers that previously selected a chess variant.
  }

  setTurn(turn: Color): void {
    this.turn = turn;
    this.ground?.set({ turnColor: turn });
    this.changed();
  }

  select(selected: Selected): void {
    this.selected = selected;
    this.redraw();
  }

  changed(validate = true): void {
    const fen = this.getFen();
    this.state = {
      ...this.state,
      fen,
      validating: validate,
      playable: validate ? false : this.state.playable,
    };
    this.cfg.options?.onChange?.(fen);
    if (!this.cfg.embed)
      history.replaceState(
        null,
        '',
        fen === this.cfg.startFen && this.orientation === 'white'
          ? this.cfg.baseUrl
          : `${this.cfg.baseUrl}/${fen.replace(/ /g, '_')}?color=${this.orientation}`,
      );
    this.redraw();
    if (validate) void this.validate();
  }

  private async validate(): Promise<void> {
    const generation = ++this.validation;
    const fen = this.getFen();
    try {
      const position = await xhr.json<PositionResponse>('/api/analysis/position', {
        method: 'post',
        body: JSON.stringify({ initialFen: fen, moves: [] }),
        headers: {
          ...xhr.jsonHeader,
          ...xhr.xhrHeader,
          'Content-Type': 'application/json',
        },
      });
      if (generation !== this.validation || fen !== this.getFen()) return;
      const legalFen = position.fen;
      this.state = {
        fen,
        legalFen,
        playable: position.gameResult === '*' && position.legalMoves.length > 0,
        validating: false,
      };
    } catch {
      if (generation !== this.validation || fen !== this.getFen()) return;
      this.state = { fen, playable: false, validating: false };
    }
    this.redraw();
  }
}

function normalizeFen(rawFen: string, fallback: string): string {
  const value = rawFen.replace(/_/g, ' ').trim();
  if (!value) return fallback;
  const fields = value.split(/\s+/);
  if (!hasBoardShape(value)) return fallback;
  const turn = fields[1] === 'b' ? 'b' : 'w';
  const halfmoves = nonNegativeInt(fields[4], 0);
  const fullmoves = Math.max(1, nonNegativeInt(fields[5], 1));
  return `${fields[0]} ${turn} - - ${halfmoves} ${fullmoves}`;
}

function hasBoardShape(fen: string): boolean {
  try {
    const placement = fen.split(/\s+/)[0];
    const board = readFen(placement, DIMENSIONS);
    return board.pieces.size >= 0 && placement.split('/').length === 10;
  } catch {
    return false;
  }
}

function nonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
