import assert from 'node:assert/strict';
import test from 'node:test';
import type { VNode } from 'snabbdom';

import { renderColumnTree, renderIndex, type ColumnTreeNode } from '../src/tree/columnView';
import { hl } from '../src/view';

interface Node extends ColumnTreeNode<Node> {
  san: string;
}

const node = (id: string, ply: number, san: string, children: Node[] = []): Node => ({
  id,
  ply,
  san,
  children,
});

function moves(vnode: VNode): VNode[] {
  const result: VNode[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if ('sel' in value && (value as VNode).sel === 'move') result.push(value as VNode);
    if ('children' in value) visit((value as VNode).children);
    if (Array.isArray(value)) value.forEach(visit);
  };
  visit(vnode);
  return result;
}

function render(root: Node): VNode {
  return renderColumnTree({
    root,
    renderMove: (move, context) =>
      hl('move', { attrs: { p: context.path }, class: { mainline: context.isMainline } }, [
        context.withIndex && renderIndex(move.ply, true),
        move.san,
      ]),
  });
}

test('renders standard mainline numbering for an even-root tree', () => {
  const tree = node('r', 0, 'root', [node('a', 1, 'A', [node('b', 2, 'B')])]);
  const rendered = moves(render(tree));

  assert.deepEqual(
    rendered.map(move => moveText(move)),
    ['A', 'B'],
  );
  assert.deepEqual(indexTexts(render(tree)), ['1']);
});

test('renders a starting index when the root begins on the second side', () => {
  const tree = node('r', 1, 'root', [node('a', 2, 'A')]);
  const rendered = moves(render(tree));

  assert.deepEqual(
    rendered.map(move => moveText(move)),
    ['A'],
  );
  assert.deepEqual(indexTexts(render(tree)), ['1']);
});

test('renders branch interruptions and omits numbering on a black continuation', () => {
  const blackMain = node('m', 2, 'M', [node('c', 3, 'C', [node('b', 4, 'B')])]);
  const redMain = node('a', 1, 'A', [blackMain, node('x', 2, 'X', [node('y', 3, 'Y', [node('z', 4, 'Z')])])]);
  const rendered = render(node('r', 0, 'root', [redMain]));
  const renderedMoves = moves(rendered);

  assert.equal(renderedMoves.length, 7);
  assert.deepEqual(
    renderedMoves.map(move => moveText(move)),
    ['A', 'M', 'X', 'Y', 'Z', 'C', 'B'],
  );
  assert.deepEqual(indexTexts(rendered), ['1', '1...', '2.', '2']);
  assert.ok(JSON.stringify(rendered).includes('interrupt'));
});

function indexTexts(vnode: VNode): string[] {
  const result: string[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if ('sel' in value && (value as VNode).sel === 'index') {
      const text = (value as VNode).text;
      if (text) result.push(text);
    }
    if ('children' in value) visit((value as VNode).children);
    if (Array.isArray(value)) value.forEach(visit);
  };
  visit(vnode);
  return result;
}

function moveText(move: VNode): string {
  const children = Array.isArray(move.children) ? move.children : [];
  const text = children.find(
    child => typeof child === 'object' && child && 'text' in child && !('sel' in child && child.sel),
  );
  return typeof text === 'object' && text && 'text' in text ? String(text.text) : '';
}
