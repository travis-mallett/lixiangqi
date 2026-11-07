import type { VisiblePiece } from '@lixiangqi/board';
type MouchEvent = MouseEvent | TouchEvent;

import { dragPiece, makeGround } from './board';
import type EditorCtrl from './ctrl';
import type { Color, EditorVariant, Selected } from './interfaces';

const pieces = ['general', 'advisor', 'elephant', 'horse', 'chariot', 'cannon', 'soldier', 'banner'] as const;

export default class EditorView {
  private turnInput?: HTMLSelectElement;
  private retryButton?: HTMLButtonElement;
  private fenError?: HTMLElement;
  private fenInput?: HTMLInputElement;
  private urlInput?: HTMLInputElement;
  private status?: HTMLElement;
  private analysisLink?: HTMLAnchorElement;
  private aiLink?: HTMLAnchorElement;
  private friendLink?: HTMLAnchorElement;
  private readonly paletteButtons: HTMLElement[] = [];
  private readonly ownerInputs = new Map<Color, HTMLSelectElement>();
  private readonly top = element('div', 'spares spares-top');
  private readonly bottom = element('div', 'spares spares-bottom');

  constructor(
    private readonly root: HTMLElement,
    private readonly ctrl: EditorCtrl,
  ) {}

  mount(): void {
    this.root.replaceChildren();
    const editor = element('div', `board-editor board-editor--${this.ctrl.adapter.variant}`);
    this.ctrl.colors.forEach(color => this.top.append(this.palette(color)));
    editor.append(this.top);

    const board = element('div', 'main-board');
    const wrap = element('div', 'cg-wrap');
    board.append(wrap);
    editor.append(board);

    editor.append(this.bottom);
    editor.append(this.controls());
    if (!this.ctrl.cfg.embed) editor.append(this.copyables());
    const help = element('p', 'board-editor__help');
    help.textContent = i18n.site.editorHelp;
    this.root.append(help, editor);

    makeGround(wrap, this.ctrl);
    this.update();
  }

  update(): void {
    const state = this.ctrl.state;
    if (this.turnInput) this.turnInput.value = this.ctrl.turn;
    for (const choice of this.turnInput?.options ?? [])
      choice.disabled = !this.ctrl.activeColors().includes(choice.value as Color);
    const owners = this.ctrl.owners();
    this.ownerInputs.forEach((input, army) => {
      input.value = owners?.[(['black', 'green', 'red'] as const).indexOf(army)] ?? '';
      for (const choice of input.options)
        choice.disabled =
          !!choice.value &&
          choice.value !== army &&
          !this.ctrl.activeColors().includes(choice.value as Color);
    });
    if (this.fenInput && document.activeElement !== this.fenInput) {
      this.fenInput.value = this.ctrl.invalidFen ?? state.fen;
      this.showFenError(this.ctrl.invalidFen !== undefined);
    }
    if (this.retryButton) this.retryButton.hidden = state.error !== 'unavailable';
    for (const palette of this.root.querySelectorAll<HTMLElement>('.spare')) {
      const bottom = palette.classList.contains(`spare-${this.ctrl.orientation}`);
      palette.classList.toggle('spare-bottom', bottom);
      palette.classList.toggle('spare-top', !bottom);
      (bottom ? this.bottom : this.top).append(palette);
    }
    if (this.urlInput) this.urlInput.value = this.editorUrl();
    if (this.status)
      this.status.textContent = state.validating
        ? i18n.site.loading
        : state.legalFen
          ? state.playable
            ? i18n.site.editorPlayable
            : i18n.site.editorGameOver
          : state.error === 'unavailable'
            ? i18n.site.editorValidationUnavailable
            : i18n.site.editorInvalid;

    const legalFen = state.legalFen;
    this.setLink(this.analysisLink, this.ctrl.analysisUrl());
    this.setLink(
      this.aiLink,
      this.ctrl.canStartGame() ? `/?fen=${encodeURIComponent(legalFen!)}#ai` : undefined,
    );
    this.setLink(
      this.friendLink,
      this.ctrl.canStartGame() ? `/?fen=${encodeURIComponent(legalFen!)}#friend` : undefined,
    );

    this.paletteButtons.forEach(button => {
      const selected = button.dataset.selection === selectionKey(this.ctrl.selected);
      button.classList.toggle('selected-square', selected);
      button.setAttribute('aria-pressed', String(selected));
      if (owners && button instanceof HTMLButtonElement && button.dataset.army)
        button.disabled =
          owners[(['black', 'green', 'red'] as const).indexOf(button.dataset.army as Color)] === null;
    });
  }

  destroy(): void {
    this.ctrl.destroy();
    this.root.replaceChildren();
  }

  private colorName(color: Color): string {
    return this.ctrl.adapter.variant === 'threeKingdoms'
      ? i18n.threeKingdoms[color]
      : color === 'red'
        ? i18n.site.red
        : i18n.site.black;
  }

  private palette(color: Color): HTMLElement {
    const palette = element('div', `spare spare-${color}`);
    palette.setAttribute('aria-label', this.colorName(color));
    palette.append(this.selectionButton('pointer', i18n.site.editorMovePieces));
    pieces
      .filter(
        role =>
          role in this.ctrl.adapter.definition.roles &&
          (role !== 'banner' || color === 'black') &&
          !(
            this.ctrl.adapter.variant === 'manchu' &&
            color === 'black' &&
            ['horse', 'cannon'].includes(role)
          ),
      )
      .forEach(piece =>
        palette.append(
          this.pieceButton(
            { face: 'up', participant: color, role: piece },
            i18n.site[`editorPiece_${piece}`],
          ),
        ),
      );
    if (this.ctrl.adapter.variant === 'jieqi')
      palette.append(
        this.pieceButton(
          { face: 'down', participant: color, back: 'default' },
          i18n.site.editorConcealedPiece,
        ),
      );
    palette.append(this.selectionButton('trash', i18n.site.editorRemovePieces));
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

  private pieceButton(piece: VisiblePiece, name: string): HTMLElement {
    const button = element('button', 'no-square');
    button.type = 'button';
    button.title = `${this.colorName(piece.participant as Color)} ${name}`;
    button.setAttribute('aria-label', button.title);
    button.dataset.selection = selectionKey(piece);
    button.dataset.army = piece.participant;
    const square = element('div');
    const face = pieceElement(
      `${piece.face === 'up' ? this.ctrl.adapter.definition.roles[piece.role] : '_'}-piece ${piece.participant === 'red' ? 'white' : piece.participant}`,
    );
    if (piece.face === 'up' && this.ctrl.adapter.variant === 'threeKingdoms')
      face.style.backgroundImage = `var(---threeKingdoms-${piece.participant}-${piece.role})`;
    square.append(face);
    button.append(square);
    const selectAndDrag = (event: MouchEvent): void => {
      if ('button' in event && event.button !== 0) return;
      const selected = this.ownedPiece(piece);
      this.ctrl.select(selected);
      if (this.ctrl.ground) dragPiece(this.ctrl.ground, selected, event);
    };
    button.addEventListener('click', () => this.ctrl.select(this.ownedPiece(piece)));
    button.addEventListener('mousedown', selectAndDrag);
    button.addEventListener('touchstart', selectAndDrag, { passive: false });
    this.paletteButtons.push(button);
    return button;
  }

  private ownedPiece(piece: VisiblePiece): VisiblePiece {
    const owners = this.ctrl.owners();
    if (!owners || piece.face !== 'up') return piece;
    const controller = owners[(['black', 'green', 'red'] as const).indexOf(piece.participant as Color)];
    return { ...piece, controller, inactive: piece.role === 'general' && controller !== piece.participant };
  }

  private controls(): HTMLElement {
    const tools = element('div', 'board-editor__tools');
    const metadata = element('div', 'metadata');
    if (!this.ctrl.cfg.embed) {
      const label = document.createElement('label');
      label.textContent = i18n.site.variant;
      const variants = document.createElement('select');
      variants.id = 'editor-variant';
      const names: Record<EditorVariant, string> = {
        xiangqi: i18n.site.xiangqi,
        jieqi: i18n.site.jieqi,
        minixiangqi: i18n.site.miniXiangqi,
        manchu: i18n.site.manchu,
        threeKingdoms: i18n.site.threeKingdoms,
      };
      for (const [variant, name] of Object.entries(names)) variants.append(option(variant, name));
      variants.value = this.ctrl.adapter.variant;
      variants.addEventListener('change', () => {
        location.href = `${this.ctrl.cfg.baseUrl}?variant=${variants.value}`;
      });
      label.append(variants);
      metadata.append(label);
    }
    const turnLabel = document.createElement('label');
    turnLabel.textContent = i18n.site.editorSideToMove;
    const turn = (this.turnInput = document.createElement('select'));
    turn.append(...this.ctrl.colors.map(color => option(color, this.colorName(color))));
    turn.value = this.ctrl.turn;
    turn.addEventListener('change', () => this.ctrl.setTurn(turn.value as Color));
    turnLabel.append(turn);
    this.status = element('p', 'board-editor__status');
    this.status.setAttribute('aria-live', 'polite');
    this.retryButton = actionButton(i18n.site.retry, () => this.ctrl.retry());
    metadata.append(turnLabel, this.status, this.retryButton);
    if (this.ctrl.owners()) {
      const owners = element('fieldset', 'board-editor__owners');
      const legend = document.createElement('legend');
      legend.textContent = i18n.site.editorArmyControl;
      owners.append(legend);
      for (const color of this.ctrl.colors) {
        const label = document.createElement('label');
        label.textContent = this.colorName(color);
        const input = document.createElement('select');
        input.append(
          ...this.ctrl.colors.map(owner => option(owner, this.colorName(owner))),
          option('', i18n.site.editorArmyRemoved),
        );
        input.addEventListener('change', () => this.ctrl.setOwner(color, (input.value as Color) || null));
        this.ownerInputs.set(color, input);
        label.append(input);
        owners.append(label);
      }
      metadata.append(owners);
    }

    const actions = element('div', 'actions');
    actions.append(
      actionButton(i18n.site.startPosition, () => this.ctrl.startPosition()),
      actionButton(i18n.site.clearBoard, () => this.ctrl.clearBoard()),
      actionButton(i18n.site.flipBoard, () => this.ctrl.flip()),
    );
    this.analysisLink = actionLink(i18n.site.analysis);
    this.aiLink = actionLink(i18n.site.playAgainstComputer);
    this.friendLink = actionLink(i18n.site.challengeAFriend);
    if (!this.ctrl.cfg.embed) actions.append(this.analysisLink, this.aiLink, this.friendLink);
    if (['jieqi', 'threeKingdoms'].includes(this.ctrl.adapter.variant)) {
      const explanation = element('p', 'board-editor__help');
      explanation.textContent =
        this.ctrl.adapter.variant === 'jieqi'
          ? i18n.site.editorJieqiAnalysisOnly
          : i18n.site.editorKingdomsAnalysisOnly;
      actions.append(explanation);
    }
    tools.append(metadata, actions);
    return tools;
  }

  private copyables(): HTMLElement {
    const copyables = element('div', 'copyables');
    this.fenInput = document.createElement('input');
    this.fenInput.type = 'text';
    this.fenInput.spellcheck = false;
    this.fenInput.id = 'editor-fen';
    this.fenInput.setAttribute('aria-describedby', 'editor-fen-error');
    this.fenError = element('p', 'error');
    this.fenError.id = 'editor-fen-error';
    this.fenError.setAttribute('role', 'alert');
    this.fenInput.addEventListener('input', () => this.showFenError(false));
    const load = () => {
      const valid = this.ctrl.setFen(this.fenInput!.value);
      this.showFenError(!valid);
      if (valid) this.fenInput!.value = this.ctrl.getFen();
    };
    this.fenInput.addEventListener('change', load);
    this.fenInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        load();
      }
    });
    this.urlInput = document.createElement('input');
    this.urlInput.type = 'text';
    this.urlInput.readOnly = true;
    this.urlInput.id = 'editor-url';
    copyables.append(
      labelledInput(this.ctrl.adapter.variant === 'threeKingdoms' ? 'TK1' : 'FEN', this.fenInput, () =>
        copy(this.fenInput!.value),
      ),
      this.fenError,
      labelledInput('URL', this.urlInput, () => copy(this.urlInput!.value)),
    );
    return copyables;
  }

  private showFenError(invalid: boolean): void {
    const message = invalid ? i18n.site.editorInvalidFen : '';
    this.fenInput?.setCustomValidity(message);
    this.fenInput?.setAttribute('aria-invalid', String(invalid));
    if (this.fenError) {
      this.fenError.textContent = message;
      this.fenError.hidden = !invalid;
    }
  }

  private editorUrl(): string {
    return new URL(this.ctrl.url(), location.href).href;
  }

  private setLink(link: HTMLAnchorElement | undefined, href: string | undefined): void {
    if (!link) return;
    link.classList.toggle('disabled', !href);
    link.setAttribute('aria-disabled', String(!href));
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
  const strong = document.createElement('label');
  strong.htmlFor = input.id;
  strong.textContent = label;
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'button button-empty';
  copyButton.textContent = i18n.site.copyToClipboard;
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

function selectionKey(selected: Selected): string {
  return typeof selected === 'string'
    ? selected
    : `${selected.participant}:${selected.face === 'up' ? selected.role : 'concealed'}`;
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
  void navigator.clipboard?.writeText(value).catch(() => {});
}
