import { mainlineFirst } from 'lib/tree/ops';

import type { AnalysisNode } from './analysisTreeView';

export interface PlayerColumn {
  key: string;
  label: string;
  title: string;
  className?: string;
}

interface Options<N extends AnalysisNode> {
  columns: readonly PlayerColumn[];
  children: (node: N) => N[];
  move: (node: N) => HTMLElement;
  comments: (node: N) => HTMLElement | DocumentFragment;
  meta: (node: N) => { mover: string; number: number };
  event: (node: N) => boolean;
  collapsed: (node: N) => boolean;
  branchLabel: (number: number, player: string) => string;
  continuationLabel?: (mainline: boolean) => string;
}

/** Actor columns stay fixed in every branch, including partial rounds and the final duel.
 * An alternative is attached below the round containing the move it replaces. Each
 * branch repeats the round number; indentation never steals space from the notation.
 */
export function renderColumnTree<N extends AnalysisNode>(root: N, opts: Options<N>): HTMLElement {
  const element = (tag: string, name: string, text?: string): HTMLElement => {
    const node = document.createElement(tag);
    node.className = name;
    if (text) node.textContent = text;
    return node;
  };
  const container = element('div', 'analysis-column-tree');
  container.style.setProperty('--player-count', String(opts.columns.length));
  const header = element('div', 'analysis-column-tree__header');
  header.append(element('span', ''));
  for (const player of opts.columns) {
    const label = element('span', player.className ?? '', player.label);
    label.title = player.title;
    header.append(label);
  }
  container.append(header, opts.comments(root));

  const branch = (first: N, depth: number, siblings: N[] = []): HTMLElement => {
    const mainline = depth === 0;
    const block = element('div', 'analysis-column-tree__branch');
    block.setAttribute('role', 'group');
    block.classList.toggle('variation', !mainline);
    block.classList.toggle('variation-even', !mainline && depth % 2 === 0);
    if (!mainline) {
      const meta = opts.meta(first);
      const column = opts.columns.findIndex(player => player.key === meta.mover);
      block.setAttribute('aria-label', opts.branchLabel(meta.number, opts.columns[column].label));
    } else if (opts.continuationLabel) block.setAttribute('aria-label', opts.continuationLabel(true));
    let node: N | undefined = first;
    let alternatives = siblings;
    let row: HTMLElement | undefined;
    let number: number | undefined;
    let pending: Array<() => void> = [];
    let interrupted = false;
    const flush = () => {
      pending.forEach(append => append());
      pending = [];
      row = undefined;
    };
    while (node) {
      const current = node;
      const meta = opts.meta(current);
      const event = opts.event(current);
      const column = opts.columns.findIndex(player => player.key === meta.mover);
      if (event || number !== meta.number) flush();
      if (!row) {
        row = element('div', 'analysis-column-tree__row');
        row.classList.toggle('continuation', interrupted);
        if (interrupted && opts.continuationLabel) {
          row.setAttribute('role', 'group');
          row.setAttribute('aria-label', opts.continuationLabel(mainline));
        }
        interrupted = false;
        row.style.setProperty('--first-column', String(event ? 0 : column));
        row.append(element('span', 'analysis-column-tree__number', event ? '·' : String(meta.number)));
        row.dataset.round = String(meta.number);
        number = meta.number;
        block.append(row);
      }
      row.style.setProperty('--last-column', String(event ? opts.columns.length : column + 1));
      const cell = opts.move(current);
      cell.style.gridColumn = event ? '2 / -1' : String(column + 2);
      row.classList.toggle('event', event);
      row.append(cell);
      pending.push(() => block.append(opts.comments(current)));
      if (!opts.collapsed(current)) {
        const variants = alternatives;
        pending.push(() => {
          variants.forEach(other => block.append(branch(other, depth + 1)));
          interrupted ||= variants.length > 0;
        });
      }
      if (event) flush();
      const next: N[] = mainline ? mainlineFirst(opts.children(current)) : opts.children(current);
      alternatives = next.slice(1);
      if (next[0]?.forceVariation && mainline) {
        flush();
        next.forEach(other => block.append(branch(other, depth + 1)));
        break;
      }
      node = next[0];
    }
    flush();
    return block;
  };
  const [first, ...others] = mainlineFirst(opts.children(root));
  if (first) {
    if (first.forceVariation) [first, ...others].forEach(node => container.append(branch(node, 1)));
    else container.append(branch(first, 0, others));
  }
  return container;
}
