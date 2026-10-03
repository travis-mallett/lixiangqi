import { selectXiangqiNotation, type XiangqiNotationStyle } from 'lib/game/xiangqi';
import { enrichText } from 'lib/richText';
import {
  canPromote,
  countNodes,
  deleteNode,
  forceVariation,
  nodeAtPath,
  pathIsForcedVariation,
  pathIsMainline,
  promote,
  type XiangqiMoveTree,
  type XiangqiPositionNode,
  type XiangqiTreeNode,
} from 'lib/tree/native';
import { mainlineFirst } from 'lib/tree/ops';
import * as treePath from 'lib/tree/path';
import type { Glyph, TreeComment } from 'lib/tree/types';
import { horizontalMoveListScrollPosition } from 'lib/view/horizontalMoveList';

import { formatEvaluation } from './evaluation';

export interface AnalysisTreeViewOptions {
  element: HTMLElement;
  tree: () => XiangqiMoveTree;
  activePath: () => string;
  setActivePath: (path: string) => void;
  notationLayout: () => 'two-column' | 'compact';
  navigate: (path: string) => void;
  commit: () => void;
  notationStyle?: () => XiangqiNotationStyle;
  readOnly?: boolean;
  emptyText?: string;
  children?: (node: XiangqiPositionNode) => XiangqiTreeNode[];
  conceal?: (node: XiangqiTreeNode, isMainline: boolean) => false | 'hide' | 'conceal' | null;
  comments?: (node: XiangqiPositionNode) => TreeComment[];
  glyphs?: (node: XiangqiTreeNode) => Glyph[];
  evaluation?: (node: XiangqiTreeNode) => { cp?: number; mate?: number } | undefined;
  moveClasses?: (node: XiangqiTreeNode) => Record<string, boolean>;
  contextMenu?: (path: string, x: number, y: number) => void;
  toggleCollapsed?: (node: XiangqiPositionNode) => void;
}

export class AnalysisTreeView {
  private menu?: HTMLElement;
  private closeListener?: (event: PointerEvent) => void;

  constructor(private readonly opts: AnalysisTreeViewOptions) {}

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
    if (scrollToActive)
      this.opts.element.querySelector<HTMLElement>('.active')?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Mobile uses the same single-row, horizontally scrollable interaction as
   * LiXiangQiTV. The shown line follows the selected variation, so navigating
   * a variation never silently jumps back to the main line.
   */
  private renderHorizontalMoves(scrollToActive: boolean): void {
    const list = document.createElement('div');
    list.className = 'xiangqi-analysis__horizontal-moves';
    const activePathParts = treePath.ids(this.opts.activePath());
    let children = this.children(this.opts.tree().root);
    let depth = 0;
    let firstInLine = true;

    while (children.length) {
      const node = children.find(candidate => candidate.id === activePathParts[depth]) ?? children[0];
      if (this.opts.conceal?.(node, pathIsMainline(this.opts.tree(), node.path)) === 'hide') break;
      list.append(this.moveElement(node, firstInLine));
      children = this.children(node);
      depth += 1;
      firstInLine = false;
    }

    this.opts.element.replaceChildren(list);
    const active = list.querySelector<HTMLElement>('.active');
    if (scrollToActive && active)
      this.opts.element.scrollLeft = horizontalMoveListScrollPosition(this.opts.element, active);
  }

  closeMenu(): void {
    if (this.closeListener) document.removeEventListener('pointerdown', this.closeListener);
    this.closeListener = undefined;
    this.menu?.remove();
    this.menu = undefined;
  }

  private children(node: XiangqiPositionNode): XiangqiTreeNode[] {
    return this.opts.children?.(node) ?? node.children;
  }

  private renderBranches(
    children: XiangqiTreeNode[],
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

  private renderBranch(
    first: XiangqiTreeNode,
    depth: number,
    isMainline: boolean,
    firstSiblings: XiangqiTreeNode[] = [],
  ): HTMLElement {
    const branch = document.createElement('div');
    branch.className = 'xiangqi-analysis__branch';
    branch.classList.toggle('mainline', isMainline);
    branch.style.setProperty('--variation-depth', String(depth));

    if (isMainline && this.opts.notationLayout() === 'two-column') {
      this.renderTwoColumnMainline(branch, first, depth, firstSiblings);
      return branch;
    }

    let node: XiangqiTreeNode | undefined = first;
    let siblings = firstSiblings;
    let firstInLine = true;
    while (node) {
      if (this.opts.conceal?.(node, isMainline) === 'hide') break;
      branch.append(this.moveElement(node, firstInLine));
      branch.append(this.commentBlock(node));
      if (!this.opts.tree().nodeAtPath(treePath.init(node.path)).collapsed)
        siblings.forEach(sibling => branch.append(this.renderBranch(sibling, depth + 1, false)));
      const next: XiangqiTreeNode[] = isMainline ? mainlineFirst(this.children(node)) : this.children(node);
      siblings = next.slice(1);
      node = next[0];
      firstInLine = false;
    }
    return branch;
  }

  private renderTwoColumnMainline(
    branch: HTMLElement,
    first: XiangqiTreeNode,
    depth: number,
    firstSiblings: XiangqiTreeNode[],
  ): void {
    let node: XiangqiTreeNode | undefined = first;
    let siblings = firstSiblings;
    let row: HTMLElement | undefined;
    let rowNumber: number | undefined;
    while (node) {
      if (this.opts.conceal?.(node, true) === 'hide') break;
      const move = moveMeta(node);
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
      if (!this.opts.tree().nodeAtPath(treePath.init(node.path)).collapsed)
        siblings.forEach(sibling => branch.append(this.renderBranch(sibling, depth + 1, false)));
      const next: XiangqiTreeNode[] = mainlineFirst(this.children(node));
      siblings = next.slice(1);
      node = next[0];
    }
  }

  private moveElement(node: XiangqiTreeNode, firstInLine: boolean): HTMLElement {
    const move = this.moveButton(node, firstInLine);
    if (this.children(node).length < 2) return move;
    const group = document.createElement('span');
    group.className = `xiangqi-analysis__move-group ${moveMeta(node).mover}-move`;
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

  private moveButton(node: XiangqiTreeNode, firstInLine: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'xiangqi-analysis__move';
    button.classList.toggle('active', this.opts.activePath() === node.path);
    button.classList.toggle('branch-point', node.children.length > 1);
    button.classList.add(`${moveMeta(node).mover}-move`);
    button.classList.toggle(
      'conceal',
      this.opts.conceal?.(node, pathIsMainline(this.opts.tree(), node.path)) === 'conceal',
    );
    for (const [name, enabled] of Object.entries(this.opts.moveClasses?.(node) ?? {}))
      button.classList.toggle(name, enabled);
    button.dataset.path = node.path;
    button.title = `${node.notation} (${node.uci})`;

    const prefix = document.createElement('span');
    prefix.className = 'move-number';
    prefix.textContent = movePrefix(node, firstInLine);
    const notation = document.createElement('span');
    notation.className = 'move-notation';
    notation.textContent = selectXiangqiNotation(
      node.notation ?? '',
      node.chineseNotation,
      this.opts.notationStyle?.() ?? 'english',
    );
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

  private commentBlock(node: XiangqiPositionNode): HTMLElement | DocumentFragment {
    const comments = this.opts.comments?.(node) ?? node.comments;
    if (!comments?.length) return document.createDocumentFragment();
    const wrapper = document.createElement('div');
    wrapper.className = 'xiangqi-analysis__comments';
    wrapper.classList.toggle(
      'conceal',
      this.opts.conceal?.(node, pathIsMainline(this.opts.tree(), node.path)) === 'conceal',
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
    const node = nodeAtPath(tree, path);
    if (!node?.path) return;
    const moveNode = node;
    this.menu = document.createElement('div');
    this.menu.className = 'xiangqi-tree-menu';
    this.menu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
    this.menu.style.top = `${Math.min(y, window.innerHeight - 220)}px`;
    const title = document.createElement('strong');
    title.textContent = `${moveNode.notation} (${moveNode.uci})`;
    this.menu.append(title);

    const onMainline = pathIsMainline(tree, path) && !pathIsForcedVariation(tree, path);
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
    if (canPromote(tree, path)) action('Promote variation', () => promote(tree, path, false));
    if (!onMainline) action('Make main line', () => promote(tree, path, true));
    if (onMainline) action('Convert to variation', () => forceVariation(tree, path, true));
    if (moveNode.children.length > 1)
      action(moveNode.collapsed ? 'Expand variations' : 'Collapse variations', () => {
        moveNode.collapsed = !moveNode.collapsed;
      });
    const count = countNodes(moveNode);
    action(`Delete ${count} move${count === 1 ? '' : 's'} from here`, () => {
      const fallback = deleteNode(tree, path);
      const activePath = this.opts.activePath();
      if (activePath === path || activePath.startsWith(`${path}.`)) this.opts.setActivePath(fallback);
    });
    document.body.append(this.menu);
    this.closeListener = event => {
      if (!this.menu?.contains(event.target as Node)) this.closeMenu();
    };
    window.setTimeout(() => {
      if (this.closeListener) document.addEventListener('pointerdown', this.closeListener);
    });
  }
}

function movePrefix(node: XiangqiTreeNode, firstInLine: boolean): string {
  const move = moveMeta(node);
  if (move.mover === 'red') return `${move.number}.`;
  return firstInLine ? `${move.number}…` : '';
}

function moveMeta(node: XiangqiTreeNode): { mover: 'red' | 'black'; number: number } {
  const mover = node.state.turn === 'black' ? 'red' : 'black';
  const fullmove = Number.parseInt(node.state.fen.trim().split(/\s+/)[5] ?? '1', 10);
  const number = mover === 'black' ? Math.max(1, fullmove - 1) : Math.max(1, fullmove);
  return { mover, number };
}

function isMobileAnalysisLayout(): boolean {
  return window.matchMedia?.('(max-width: 799px)').matches ?? false;
}
