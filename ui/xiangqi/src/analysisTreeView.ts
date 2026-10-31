import { selectXiangqiNotation, type XiangqiNotationStyle } from 'lib/game/xiangqi';
import { enrichText } from 'lib/richText';
import type { XiangqiTreeNode } from 'lib/tree/native';
import { mainlineFirst } from 'lib/tree/ops';
import type { Glyph, TreeComment } from 'lib/tree/types';
import { horizontalMoveListScrollPosition } from 'lib/view/horizontalMoveList';

import { formatEvaluation } from './evaluation';

/** Presentation and tree editing do not depend on two-player rules or FEN. */
export interface AnalysisNode {
  state?: XiangqiTreeNode['state'];
  id: string;
  path: string;
  ply: number;
  uci?: string;
  notation?: string;
  chineseNotation?: string;
  children: AnalysisNode[];
  comments?: TreeComment[];
  glyphs?: Glyph[];
  evaluation?: { cp?: number; mate?: number };
  collapsed?: boolean;
  forceVariation?: boolean;
}
export interface AnalysisTree<N extends AnalysisNode> {
  root: N;
  nodeAtPath(path: string): N;
  parentNode(path: string): N;
  pathExists(path: string): boolean;
  pathIsMainline(path: string): boolean;
  pathIsForcedVariation(path: string): boolean;
  promoteAt(path: string, mainline: boolean): void;
  forceVariationAt(path: string, force: boolean): void;
  deleteNodeAt(path: string): void;
}
export interface AnalysisTreeViewOptions<N extends AnalysisNode = XiangqiTreeNode> {
  element: HTMLElement;
  tree: () => AnalysisTree<N>;
  activePath: () => string;
  setActivePath: (path: string) => void;
  notationLayout: () => 'two-column' | 'compact';
  navigate: (path: string) => void;
  commit: () => void;
  moveMeta?: (node: N) => { mover: string; number: number };
  notation?: (node: N) => string;
  notationStyle?: () => XiangqiNotationStyle;
  readOnly?: boolean;
  emptyText?: string;
  children?: (node: N) => N[];
  conceal?: (node: N, isMainline: boolean) => false | 'hide' | 'conceal' | null;
  comments?: (node: N) => TreeComment[];
  glyphs?: (node: N) => Glyph[];
  evaluation?: (node: N) => { cp?: number; mate?: number } | undefined;
  moveClasses?: (node: N) => Record<string, boolean>;
  contextMenu?: (path: string, x: number, y: number) => void;
  toggleCollapsed?: (node: N) => void;
}

export class AnalysisTreeView<N extends AnalysisNode = XiangqiTreeNode> {
  private menu?: HTMLElement;
  private readonly escapeListener = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMenu();
    }
  };
  private closeListener?: (event: PointerEvent) => void;

  constructor(private readonly opts: AnalysisTreeViewOptions<N>) {}

  render({ scrollToActive = true }: { scrollToActive?: boolean } = {}): void {
    const children = this.children(this.opts.tree().root);
    if (!children.length) {
      const empty = document.createElement('span');
      empty.className = 'xiangqi-analysis__empty';
      empty.textContent = this.opts.emptyText ?? 'Play a move on the board to begin analysis.';
      this.opts.element.replaceChildren(this.commentBlock(this.opts.tree().root), empty);
      return;
    }

    if (isMobileAnalysisLayout()) {
      this.renderHorizontalMoves(scrollToActive);
      return;
    }

    const fragment = document.createDocumentFragment();
    fragment.append(this.commentBlock(this.opts.tree().root));
    this.renderBranches(children, fragment, 0, true);
    this.opts.element.replaceChildren(fragment);
    if (scrollToActive) this.scrollToActive();
  }

  scrollToActive(): void {
    const element = this.opts.element;
    const active = element.querySelector<HTMLElement>('.active');
    if (!active) return;
    if (isMobileAnalysisLayout()) {
      element.scrollLeft = horizontalMoveListScrollPosition(element, active);
    } else {
      const bounds = element.getBoundingClientRect();
      const selected = active.getBoundingClientRect();
      // Scroll only the move list; revealing a move must not move the page itself.
      const top = bounds.top + element.clientTop;
      const bottom = bounds.bottom - (parseFloat(window.getComputedStyle(element).borderBottomWidth) || 0);
      if (selected.top < top) element.scrollTop -= Math.ceil(top - selected.top);
      else if (selected.bottom > bottom) element.scrollTop += Math.ceil(selected.bottom - bottom);
    }
  }

  /**
   * Mobile uses the same single-row, horizontally scrollable interaction as
   * LiXiangQiTV. The shown line follows the selected variation, so navigating
   * a variation never silently jumps back to the main line.
   */
  private renderHorizontalMoves(scrollToActive: boolean): void {
    const list = document.createElement('div');
    list.className = 'xiangqi-analysis__horizontal-moves';
    const activePathParts = this.opts.activePath().split('/').filter(Boolean);
    let children = this.children(this.opts.tree().root);
    let depth = 0;
    let firstInLine = true;

    while (children.length) {
      const node = children.find(candidate => candidate.id === activePathParts[depth]) ?? children[0];
      if (this.opts.conceal?.(node, this.opts.tree().pathIsMainline(node.path)) === 'hide') break;
      list.append(this.moveElement(node, firstInLine));
      children = this.children(node);
      depth += 1;
      firstInLine = false;
    }

    this.opts.element.replaceChildren(list);
    if (scrollToActive) this.scrollToActive();
  }

  closeMenu(): void {
    document.removeEventListener('keydown', this.escapeListener);
    if (this.closeListener) document.removeEventListener('pointerdown', this.closeListener);
    this.closeListener = undefined;
    this.menu?.remove();
    this.menu = undefined;
  }

  private children(node: N): N[] {
    return this.opts.children?.(node) ?? (node.children as N[]);
  }

  private renderBranches(
    children: N[],
    container: DocumentFragment | HTMLElement,
    depth: number,
    isMainline: boolean,
  ): void {
    const [main, ...variations] = isMainline ? mainlineFirst(children) : children;
    if (!main) return;
    if (main.forceVariation && isMainline) {
      children.forEach(child => container.append(this.renderBranch(child, depth + 1, false)));
      return;
    }
    container.append(this.renderBranch(main, depth, isMainline, variations));
  }

  private renderBranch(first: N, depth: number, isMainline: boolean, firstSiblings: N[] = []): HTMLElement {
    const branch = document.createElement('div');
    branch.className = 'xiangqi-analysis__branch';
    branch.classList.toggle('mainline', isMainline);
    branch.style.setProperty('--variation-depth', String(depth));

    if (isMainline && this.opts.notationLayout() === 'two-column') {
      this.renderTwoColumnMainline(branch, first, depth, firstSiblings);
      return branch;
    }

    let node: N | undefined = first;
    let siblings = firstSiblings;
    let firstInLine = true;
    while (node) {
      if (this.opts.conceal?.(node, isMainline) === 'hide') break;
      branch.append(this.moveElement(node, firstInLine));
      branch.append(this.commentBlock(node));
      if (!this.opts.tree().parentNode(node.path).collapsed)
        siblings.forEach(sibling => branch.append(this.renderBranch(sibling, depth + 1, false)));
      const next: N[] = isMainline ? mainlineFirst(this.children(node)) : this.children(node);
      siblings = next.slice(1);
      node = next[0];
      firstInLine = false;
    }
    return branch;
  }

  private renderTwoColumnMainline(branch: HTMLElement, first: N, depth: number, firstSiblings: N[]): void {
    let node: N | undefined = first;
    let siblings = firstSiblings;
    let row: HTMLElement | undefined;
    let rowNumber: number | undefined;
    while (node) {
      if (this.opts.conceal?.(node, true) === 'hide') break;
      const move = this.moveMeta(node);
      if (!row || rowNumber !== move.number) {
        row = document.createElement('div');
        row.className = 'xiangqi-analysis__move-row';
        const number = document.createElement('span');
        number.className = 'move-row-number';
        number.textContent = String(move.number);
        row.append(number);
        branch.append(row);
        rowNumber = move.number;
      }
      row.append(this.moveElement(node, false));
      branch.append(this.commentBlock(node));
      if (!this.opts.tree().parentNode(node.path).collapsed)
        siblings.forEach(sibling => branch.append(this.renderBranch(sibling, depth + 1, false)));
      const next: N[] = mainlineFirst(this.children(node));
      siblings = next.slice(1);
      node = next[0];
    }
  }

  private moveElement(node: N, firstInLine: boolean): HTMLElement {
    const move = this.moveButton(node, firstInLine);
    if (this.children(node).length < 2) return move;
    const group = document.createElement('span');
    group.className = `xiangqi-analysis__move-group ${this.moveMeta(node).mover}-move`;
    const disclosure = document.createElement('button');
    disclosure.type = 'button';
    disclosure.className = 'xiangqi-analysis__disclosure';
    disclosure.textContent = node.collapsed ? '＋' : '−';
    disclosure.setAttribute('aria-expanded', String(!node.collapsed));
    disclosure.setAttribute(
      'aria-label',
      node.collapsed ? i18n.site.expandVariations : i18n.site.collapseVariations,
    );
    disclosure.addEventListener('click', () => {
      if (this.opts.toggleCollapsed) this.opts.toggleCollapsed(node);
      else {
        node.collapsed = !node.collapsed;
        this.opts.commit();
      }
    });
    group.append(move, disclosure);
    return group;
  }

  private moveNotation(node: N): string {
    if (this.opts.notation) return this.opts.notation(node);
    return selectXiangqiNotation(
      node.notation ?? '',
      node.chineseNotation,
      this.opts.notationStyle?.() ?? 'english',
      node.state?.reveal,
    );
  }

  private moveButton(node: N, firstInLine: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'xiangqi-analysis__move';
    button.classList.toggle('active', this.opts.activePath() === node.path);
    button.classList.toggle('branch-point', node.children.length > 1);
    button.classList.add(`${this.moveMeta(node).mover}-move`);
    button.classList.toggle(
      'conceal',
      this.opts.conceal?.(node, this.opts.tree().pathIsMainline(node.path)) === 'conceal',
    );
    for (const [name, enabled] of Object.entries(this.opts.moveClasses?.(node) ?? {}))
      button.classList.toggle(name, enabled);
    button.dataset.path = node.path;
    button.title = `${this.moveNotation(node)} (${node.uci})`;

    const prefix = document.createElement('span');
    prefix.className = 'move-number';
    prefix.textContent = this.movePrefix(node, firstInLine);
    const notation = document.createElement('span');
    notation.className = 'move-notation';
    notation.textContent = this.moveNotation(node);
    button.append(prefix, notation);
    for (const glyph of this.opts.glyphs?.(node) ?? node.glyphs ?? []) {
      const annotation = document.createElement('span');
      annotation.className = 'move-glyph';
      annotation.textContent = glyph.symbol;
      annotation.title = glyph.name;
      button.append(annotation);
    }
    const evaluation = this.opts.evaluation ? this.opts.evaluation(node) : node.evaluation;
    if (evaluation) {
      const score = document.createElement('span');
      score.className = 'move-eval';
      score.textContent = formatEvaluation({ redCp: evaluation.cp, redMate: evaluation.mate });
      button.append(score);
    }

    let longPress: number | undefined;
    let openedByPress = false;
    button.addEventListener('click', event => {
      if (openedByPress) {
        openedByPress = false;
        event.preventDefault();
        return;
      }
      this.opts.navigate(node.path);
    });
    if (this.opts.readOnly) return button;
    button.addEventListener('contextmenu', event => {
      event.preventDefault();
      this.openMenu(node.path, event.clientX, event.clientY);
    });
    button.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse') return;
      longPress = window.setTimeout(() => {
        openedByPress = true;
        const rect = button.getBoundingClientRect();
        this.openMenu(node.path, rect.left + rect.width / 2, rect.top + rect.height / 2);
      }, 550);
    });
    for (const eventName of ['pointerup', 'pointercancel', 'pointerleave'] as const)
      button.addEventListener(eventName, () => window.clearTimeout(longPress));
    return button;
  }

  private commentBlock(node: N): HTMLElement | DocumentFragment {
    const comments = this.opts.comments?.(node) ?? node.comments;
    if (!comments?.length) return document.createDocumentFragment();
    const wrapper = document.createElement('div');
    wrapper.className = 'xiangqi-analysis__comments';
    wrapper.classList.toggle(
      'conceal',
      this.opts.conceal?.(node, this.opts.tree().pathIsMainline(node.path)) === 'conceal',
    );
    comments.forEach(comment => {
      const entry = document.createElement('p');
      const author = comment.author ?? (comment.by && 'name' in comment.by ? comment.by.name : undefined);
      if (comment.source || author) {
        const attribution = document.createElement('strong');
        attribution.textContent = [comment.source, author].filter(Boolean).join(' · ');
        entry.append(attribution, document.createTextNode(' '));
      }
      const text = document.createElement('span');
      text.innerHTML = enrichText(comment.text);
      entry.append(text);
      wrapper.append(entry);
    });
    return wrapper;
  }

  private openMenu(path: string, x: number, y: number): void {
    this.closeMenu();
    if (this.opts.contextMenu) return this.opts.contextMenu(path, x, y);
    const tree = this.opts.tree();
    const node = tree.pathExists(path) ? tree.nodeAtPath(path) : undefined;
    if (!node?.path) return;
    const moveNode = node;
    this.menu = document.createElement('div');
    this.menu.className = 'xiangqi-tree-menu';
    this.menu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
    this.menu.style.top = `${Math.min(y, window.innerHeight - 220)}px`;
    const title = document.createElement('strong');
    title.textContent = `${this.moveNotation(moveNode)} (${moveNode.uci})`;
    this.menu.append(title);

    const onMainline = tree.pathIsMainline(path) && !tree.pathIsForcedVariation(path);
    const action = (label: string, apply: () => void): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => {
        apply();
        this.closeMenu();
        this.opts.commit();
      });
      this.menu?.append(button);
    };
    if (!onMainline) action('Promote variation', () => tree.promoteAt(path, false));
    if (!onMainline) action('Make main line', () => tree.promoteAt(path, true));
    if (onMainline) action('Convert to variation', () => tree.forceVariationAt(path, true));
    if (moveNode.children.length > 1)
      action(moveNode.collapsed ? 'Expand variations' : 'Collapse variations', () => {
        moveNode.collapsed = !moveNode.collapsed;
      });
    const countNodes = (n: AnalysisNode): number =>
      1 + n.children.reduce((sum, child) => sum + countNodes(child), 0);
    const count = countNodes(moveNode);
    action(`Delete ${count} move${count === 1 ? '' : 's'} from here`, () => {
      const fallback = tree.parentNode(path).path;
      const activePath = this.opts.activePath();
      tree.deleteNodeAt(path);
      if (activePath === path || activePath.startsWith(path + '/')) this.opts.setActivePath(fallback);
    });
    document.body.append(this.menu);
    document.addEventListener('keydown', this.escapeListener);
    this.closeListener = event => {
      if (!this.menu?.contains(event.target as Node)) this.closeMenu();
    };
    window.setTimeout(() => {
      if (this.closeListener) document.addEventListener('pointerdown', this.closeListener);
    });
  }

  private movePrefix(node: N, firstInLine: boolean): string {
    const move = this.moveMeta(node);
    if (move.mover === 'red') return `${move.number}.`;
    return firstInLine ? `${move.number}…` : '';
  }

  private moveMeta(node: N): { mover: string; number: number } {
    if (this.opts.moveMeta) return this.opts.moveMeta(node);
    const { state } = node;
    if (!state) throw new Error('Analysis adapter must provide move metadata');
    const mover = state.turn === 'black' ? 'red' : 'black';
    const fullmove = Number.parseInt(state.fen.trim().split(/\s+/)[5] ?? '1', 10);
    return { mover, number: mover === 'black' ? Math.max(1, fullmove - 1) : Math.max(1, fullmove) };
  }
}

function isMobileAnalysisLayout(): boolean {
  return window.matchMedia?.('(max-width: 799px)').matches ?? false;
}
