import type { BoardPosition, BoardView } from '@lixiangqi/board';

import { XiangqiRequestError } from 'lib/game/xiangqiApi';

import type { Color, Config, EditorState, Redraw, Selected } from './interfaces';
import { InvalidPosition, rectangularPosition, type EditorPosition } from './position';

export default class EditorCtrl {
  ground?: BoardView;
  selected: Selected = 'pointer';
  orientation: Color;
  turn: Color;
  state: EditorState;
  invalidFen?: string;
  private validation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private request?: AbortController;
  private destroyed = false;

  constructor(
    readonly cfg: Config,
    readonly redraw: Redraw,
    readonly adapter: EditorPosition = rectangularPosition(cfg),
  ) {
    this.orientation = this.colors.includes(cfg.options?.orientation ?? 'red')
      ? (cfg.options?.orientation ?? 'red')
      : 'red';
    const parsed = adapter.read(cfg.fen ?? adapter.startFen);
    const fallback = adapter.read(adapter.startFen)!;
    const empty = adapter.write({ ...fallback.position, pieces: new Map() }, fallback.fen);
    if (!parsed) this.invalidFen = cfg.fen;
    this.turn = (parsed ?? fallback).position.active as Color;
    this.state = { fen: parsed?.fen ?? empty, validating: !!parsed, playable: false };
  }

  get colors(): readonly Color[] {
    return this.adapter.definition.participants as readonly Color[];
  }

  position(): BoardPosition {
    return this.adapter.read(this.state.fen)!.position;
  }

  attachGround(ground: BoardView): void {
    this.ground = ground;
    if (this.invalidFen === undefined) this.validateSoon();
  }

  getFen(): string {
    return this.state.fen;
  }

  setFen(rawFen: string): boolean {
    const parsed = this.adapter.read(rawFen);
    if (!parsed) return false;
    this.turn = parsed.position.active as Color;
    this.setPosition(parsed.fen, parsed.position);
    return true;
  }

  startPosition(): void {
    this.setFen(this.adapter.startFen);
  }

  clearBoard(): void {
    const start = this.adapter.read(this.adapter.startFen)!;
    const position = { ...start.position, active: this.turn, pieces: new Map() };
    this.setPosition(this.adapter.write(position, start.fen), position);
  }

  flip(): void {
    this.setOrientation(this.colors[(this.colors.indexOf(this.orientation) + 1) % this.colors.length]);
  }

  setOrientation(orientation: Color): void {
    if (!this.colors.includes(orientation)) return;
    this.orientation = orientation;
    if (this.ground)
      this.ground.setPresentation({ ...this.ground.getPresentation(), perspective: orientation });
    this.updateUrl();
    this.redraw();
  }

  setTurn(turn: Color): void {
    if (!this.activeColors().includes(turn)) return;
    this.turn = turn;
    if (this.ground) this.ground.display({ ...this.ground.position(), active: turn }, { kind: 'edit' });
    this.changed();
  }

  owners(): (Color | null)[] | undefined {
    return this.adapter.owners?.(this.state.fen);
  }

  activeColors(): readonly Color[] {
    const owners = this.owners();
    return owners
      ? (['black', 'green', 'red'] as const).filter((color, i) => owners[i] === color)
      : this.colors;
  }

  setOwner(army: Color, owner: Color | null): void {
    const owners = this.owners();
    if (!owners) return;
    const order: Color[] = ['black', 'green', 'red'];
    const old = owners[order.indexOf(army)];
    // When an active player leaves, their controlled armies follow the same owner.
    order.forEach((color, i) => {
      if (color === army || (old === army && owners[i] === army)) owners[i] = owner;
    });
    if (!owners.some((color, i) => color === order[i])) {
      this.redraw();
      return;
    }
    const position = this.ground?.position() ?? this.position();
    const active =
      owners[order.indexOf(this.turn)] === this.turn
        ? this.turn
        : order.find((color, i) => owners[i] === color)!;
    const pieces = new Map(
      [...position.pieces].filter(
        ([, p]) => !!p.participant && owners[order.indexOf(p.participant as Color)] !== null,
      ),
    );
    const fen = this.adapter.write({ ...position, active, pieces }, this.state.fen, owners);
    this.selected = 'pointer';
    this.setFen(fen);
  }

  select(selected: Selected): void {
    this.ground?.cancelInput();
    this.selected = selected;
    this.redraw();
  }

  changed(): void {
    const position = { ...(this.ground?.position() ?? this.position()), active: this.turn };
    this.setPosition(this.adapter.write(position, this.state.fen));
  }

  private setPosition(fen: string, position?: BoardPosition): void {
    this.invalidFen = undefined;
    this.state = { fen, validating: true, playable: false };
    if (position) this.ground?.display(position, { kind: 'edit' });
    this.cfg.options?.onChange?.(fen);
    this.updateUrl();
    this.redraw();
    this.validateSoon();
  }

  url(): string {
    if (
      this.adapter.variant === 'xiangqi' &&
      this.state.fen === this.adapter.startFen &&
      this.orientation === 'red'
    )
      return this.cfg.baseUrl;
    return `${this.cfg.baseUrl}?${new URLSearchParams({ variant: this.adapter.variant, fen: this.state.fen, color: this.orientation })}`;
  }

  analysisUrl(): string | undefined {
    if (!this.state.legalFen) return;
    return this.adapter.variant === 'threeKingdoms'
      ? `/analysis/threeKingdoms?${new URLSearchParams({ position: this.state.legalFen, color: this.orientation })}`
      : `/analysis?${new URLSearchParams({ fen: this.state.legalFen, color: this.orientation })}`;
  }

  canStartGame(): boolean {
    return this.state.playable && !['jieqi', 'threeKingdoms'].includes(this.adapter.variant);
  }

  private updateUrl(): void {
    if (!this.cfg.embed && this.invalidFen === undefined) history.replaceState(null, '', this.url());
  }

  retry(): void {
    this.state = { fen: this.state.fen, validating: true, playable: false };
    this.redraw();
    this.validateSoon();
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelValidation();
    this.ground?.destroy();
  }

  private cancelValidation(): void {
    ++this.validation;
    clearTimeout(this.timer);
    this.request?.abort();
  }

  private validateSoon(): void {
    this.cancelValidation();
    const generation = this.validation;
    this.timer = setTimeout(() => void this.validate(generation), 200);
  }

  private async validate(generation: number): Promise<void> {
    const fen = this.state.fen;
    this.request = new AbortController();
    try {
      const position = await this.adapter.validate(fen, this.request.signal);
      if (this.destroyed || generation !== this.validation) return;
      this.state = { fen, legalFen: position.fen, playable: position.playable, validating: false };
    } catch (error) {
      if (this.destroyed || generation !== this.validation) return;
      this.state = {
        fen,
        playable: false,
        validating: false,
        error:
          error instanceof InvalidPosition || (error instanceof XiangqiRequestError && error.status === 400)
            ? 'invalid'
            : 'unavailable',
      };
    }
    this.redraw();
  }
}
