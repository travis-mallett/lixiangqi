import { formatEvaluation } from './evaluation';
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
} from './tree';

export interface AnalysisTreeViewOptions {
  element: HTMLElement;
  tree: () => XiangqiMoveTree;
  activePath: () => string;
  setActivePath: (path: string) => void;
  notationLayout: () => 'two-column' | 'compact';
  navigate: (path: string) => void;
  commit: () => void;
}

export class AnalysisTreeView {
  private menu?: HTMLElement;
  private closeListener?: (event: PointerEvent) => void;

  constructor(private readonly opts: AnalysisTreeViewOptions) {}

  render({ scrollToActive = true }: { scrollToActive?: boolean } = {}): void {
    const children = this.opts.tree().root.children;
    if (!children.length) {
      const empty = document.createElement('span');
      empty.className = 'xiangqi-analysis__empty';
      empty.textContent = 'Play a move on the board to begin analysis.';
      this.opts.element.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    if (this.opts.tree().root.comments?.length) fragment.append(this.commentBlock(this.opts.tree().root));
    this.renderBranches(children, fragment, 0, true);
    this.opts.element.replaceChildren(fragment);
    if (scrollToActive)
      this.opts.element.querySelector<HTMLElement>('.active')?.scrollIntoView({ block: 'nearest' });
  }

  closeMenu(): void {
    if (this.closeListener) document.removeEventListener('pointerdown', this.closeListener);
    this.closeListener = undefined;
    this.menu?.remove();
    this.menu = undefined;
  }

  private renderBranches(
    children: XiangqiTreeNode[],
    container: DocumentFragment | HTMLElement,
    depth: number,
    isMainline: boolean,
  ): void {
    const [main, ...variations] = children;
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
      branch.append(this.moveButton(node, firstInLine));
      if (node.comments?.length) branch.append(this.commentBlock(node));
      if (!node.collapsed)
        siblings.forEach(sibling => branch.append(this.renderBranch(sibling, depth + 1, false)));
      siblings = node.children.slice(1);
      node = node.children[0];
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
      row.append(this.moveButton(node, false));
      if (node.comments?.length) branch.append(this.commentBlock(node));
      if (!node.collapsed)
        siblings.forEach(sibling => branch.append(this.renderBranch(sibling, depth + 1, false)));
      siblings = node.children.slice(1);
      node = node.children[0];
    }
  }

  private moveButton(node: XiangqiTreeNode, firstInLine: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'xiangqi-analysis__move';
    button.classList.toggle('active', this.opts.activePath() === node.path);
    button.classList.toggle('branch-point', node.children.length > 1);
    button.classList.add(`${moveMeta(node).mover}-move`);
    button.dataset.path = node.path;
    button.title = `${node.notation} (${node.uci})`;

    const prefix = document.createElement('span');
    prefix.className = 'move-number';
    prefix.textContent = movePrefix(node, firstInLine);
    const notation = document.createElement('span');
    notation.className = 'move-notation';
    notation.textContent = node.notation;
    button.append(prefix, notation);
    if (node.evaluation) {
      const score = document.createElement('span');
      score.className = 'move-eval';
      score.textContent = formatEvaluation(node.evaluation.score);
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

  private commentBlock(node: XiangqiPositionNode): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'xiangqi-analysis__comments';
    node.comments?.forEach(comment => {
      const entry = document.createElement('p');
      if (comment.source || comment.author) {
        const attribution = document.createElement('strong');
        attribution.textContent = [comment.source, comment.author].filter(Boolean).join(' · ');
        entry.append(attribution, document.createTextNode(' '));
      }
      entry.append(document.createTextNode(comment.text));
      wrapper.append(entry);
    });
    return wrapper;
  }

  private openMenu(path: string, x: number, y: number): void {
    this.closeMenu();
    const tree = this.opts.tree();
    const node = nodeAtPath(tree, path);
    if (!node?.path) return;
    const moveNode = node as XiangqiTreeNode;
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
