import type { Color, MouchEvent, Piece, Role } from 'chessgroundx/types';

import { dragPiece, makeGround } from './chessground';
import type EditorCtrl from './ctrl';
import type { Selected } from './interfaces';

const pieces: Array<{ role: Role; name: string }> = [
  { role: 'k-piece', name: 'General' },
  { role: 'a-piece', name: 'Advisor' },
  { role: 'b-piece', name: 'Elephant' },
  { role: 'n-piece', name: 'Horse' },
  { role: 'r-piece', name: 'Chariot' },
  { role: 'c-piece', name: 'Cannon' },
  { role: 'p-piece', name: 'Soldier' },
];

export default class EditorView {
  private fenInput?: HTMLInputElement;
  private urlInput?: HTMLInputElement;
  private status?: HTMLElement;
  private analysisLink?: HTMLAnchorElement;
  private aiLink?: HTMLAnchorElement;
  private friendLink?: HTMLAnchorElement;
  private readonly paletteButtons: HTMLElement[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly ctrl: EditorCtrl,
  ) {}

  mount(): void {
    this.root.replaceChildren();
    const editor = element('div', 'board-editor board-editor--xiangqi');
    editor.append(this.palette('black', 'top'));

    const board = element('div', 'main-board xiangqi9x10');
    const wrap = element('div', 'cg-wrap xiangqi9x10');
    board.append(wrap);
    editor.append(board);

    editor.append(this.palette('white', 'bottom'));
    editor.append(this.controls());
    if (!this.ctrl.cfg.embed) editor.append(this.copyables());
    this.root.append(editor);

    makeGround(wrap, this.ctrl);
    this.update();
  }

  update(): void {
    const state = this.ctrl.state;
    if (this.fenInput && document.activeElement !== this.fenInput) this.fenInput.value = state.fen;
    if (this.urlInput) this.urlInput.value = this.editorUrl();
    if (this.status)
      this.status.textContent = state.validating
        ? 'Validating with the native Xiangqi rules boundary…'
        : state.legalFen
          ? state.playable
            ? 'Playable Xiangqi position'
            : 'Valid Xiangqi position; the game is already over'
          : 'Invalid Xiangqi position';

    const legalFen = state.legalFen;
    this.setLink(
      this.analysisLink,
      legalFen ? `/analysis?fen=${encodeURIComponent(legalFen)}&color=${this.ctrl.orientation}` : undefined,
    );
    this.setLink(this.aiLink, state.playable ? `/?fen=${encodeURIComponent(legalFen!)}#ai` : undefined);
    this.setLink(
      this.friendLink,
      state.playable ? `/?fen=${encodeURIComponent(legalFen!)}#friend` : undefined,
    );

    this.paletteButtons.forEach(button => {
      button.classList.toggle(
        'selected-square',
        button.dataset.selection === selectionKey(this.ctrl.selected),
      );
    });
  }

  destroy(): void {
    this.ctrl.ground?.destroy();
    this.root.replaceChildren();
  }

  private palette(color: Color, position: 'top' | 'bottom'): HTMLElement {
    const palette = element('div', `spare spare-${position} spare-${color}`);
    palette.setAttribute('aria-label', `${color === 'white' ? 'Red' : 'Black'} pieces`);
    palette.append(this.selectionButton('pointer', 'Move pieces'));
    pieces.forEach(piece => palette.append(this.pieceButton({ color, role: piece.role }, piece.name)));
    palette.append(this.selectionButton('trash', 'Remove pieces'));
    return palette;
  }

  private selectionButton(selected: 'pointer' | 'trash', label: string): HTMLElement {
    const button = element('button', `no-square ${selected}`);
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.dataset.selection = selected;
    const square = element('div');
    square.append(pieceElement(selected));
    button.append(square);
    button.addEventListener('click', () => this.ctrl.select(selected));
    this.paletteButtons.push(button);
    return button;
  }

  private pieceButton(piece: Piece, name: string): HTMLElement {
    const button = element('button', 'no-square');
    button.type = 'button';
    button.title = `${piece.color === 'white' ? 'Red' : 'Black'} ${name}`;
    button.setAttribute('aria-label', button.title);
    button.dataset.selection = selectionKey(piece);
    const square = element('div');
    square.append(pieceElement(`${piece.role} ${piece.color}`));
    button.append(square);
    const selectAndDrag = (event: MouchEvent): void => {
      this.ctrl.select(piece);
      if (this.ctrl.ground) dragPiece(this.ctrl.ground, piece, event);
    };
    button.addEventListener('mousedown', selectAndDrag);
    button.addEventListener('touchstart', selectAndDrag, { passive: false });
    this.paletteButtons.push(button);
    return button;
  }

  private controls(): HTMLElement {
    const tools = element('div', 'board-editor__tools');
    const metadata = element('div', 'metadata');
    const turnLabel = document.createElement('label');
    turnLabel.textContent = 'Side to move';
    const turn = document.createElement('select');
    turn.append(option('white', 'Red'), option('black', 'Black'));
    turn.value = this.ctrl.turn;
    turn.addEventListener('change', () => this.ctrl.setTurn(turn.value as Color));
    turnLabel.append(turn);
    this.status = element('p', 'board-editor__status');
    this.status.setAttribute('aria-live', 'polite');
    metadata.append(turnLabel, this.status);

    const actions = element('div', 'actions');
    actions.append(
      actionButton('Starting position', () => this.ctrl.startPosition()),
      actionButton('Clear board', () => this.ctrl.clearBoard()),
      actionButton('Flip board', () => this.ctrl.flip()),
    );
    this.analysisLink = actionLink('Analysis board');
    this.aiLink = actionLink('Play against computer');
    this.friendLink = actionLink('Challenge a friend');
    actions.append(this.analysisLink, this.aiLink, this.friendLink);
    tools.append(metadata, actions);
    return tools;
  }

  private copyables(): HTMLElement {
    const copyables = element('div', 'copyables');
    this.fenInput = document.createElement('input');
    this.fenInput.type = 'text';
    this.fenInput.spellcheck = false;
    this.fenInput.addEventListener('change', () => {
      if (!this.ctrl.setFen(this.fenInput!.value)) {
        this.fenInput!.setCustomValidity('Use a 9 by 10 Xiangqi FEN');
        this.fenInput!.reportValidity();
      } else this.fenInput!.setCustomValidity('');
    });
    this.urlInput = document.createElement('input');
    this.urlInput.type = 'text';
    this.urlInput.readOnly = true;
    copyables.append(
      labelledInput('FEN', this.fenInput, () => copy(this.fenInput!.value)),
      labelledInput('URL', this.urlInput, () => copy(this.urlInput!.value)),
    );
    return copyables;
  }

  private editorUrl(): string {
    const fen = this.ctrl.state.legalFen ?? this.ctrl.state.fen;
    return fen === this.ctrl.cfg.startFen && this.ctrl.orientation === 'white'
      ? new URL(this.ctrl.cfg.baseUrl, location.href).href
      : new URL(
          `${this.ctrl.cfg.baseUrl}/${fen.replace(/ /g, '_')}?color=${this.ctrl.orientation}`,
          location.href,
        ).href;
  }

  private setLink(link: HTMLAnchorElement | undefined, href: string | undefined): void {
    if (!link) return;
    link.classList.toggle('disabled', !href);
    link.toggleAttribute('aria-disabled', !href);
    if (href) link.href = href;
    else link.removeAttribute('href');
  }
}

function actionButton(label: string, action: () => void): HTMLButtonElement {
  const button = element('button', 'button button-empty text');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function actionLink(label: string): HTMLAnchorElement {
  const link = element('a', 'button button-empty text');
  link.textContent = label;
  link.rel = 'nofollow';
  return link;
}

function labelledInput(label: string, input: HTMLInputElement, copyValue: () => void): HTMLElement {
  const row = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = label;
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'button button-empty';
  copyButton.textContent = 'Copy';
  copyButton.addEventListener('click', copyValue);
  row.append(strong, input, copyButton);
  return row;
}

function option(value: string, label: string): HTMLOptionElement {
  const item = document.createElement('option');
  item.value = value;
  item.textContent = label;
  return item;
}

function selectionKey(selected: Selected | Piece): string {
  return typeof selected === 'string' ? selected : `${selected.color}:${selected.role}`;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function pieceElement(className: string): HTMLElement {
  const piece = document.createElement('piece');
  piece.className = className;
  return piece;
}

function copy(value: string): void {
  void navigator.clipboard?.writeText(value);
}
