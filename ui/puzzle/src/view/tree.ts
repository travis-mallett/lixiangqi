import type { VNode, Classes } from 'snabbdom';

import { defined } from 'lib';
import { throttle } from 'lib/async';
import { renderEval as normalizeEval } from 'lib/ceval';
import { renderColumnTree, renderIndex as renderTreeIndex } from 'lib/tree/columnView';
import { path as treePath } from 'lib/tree/tree';
import type { TreeNode, TreePath } from 'lib/tree/types';
import { type MaybeVNode, type LooseVNodes, hl, onInsert } from 'lib/view';

import type PuzzleCtrl from '@/ctrl';

export const renderIndex = renderTreeIndex;

interface Ctx {
  ctrl: PuzzleCtrl;
  showComputer: boolean;
}

interface Glyph {
  name: string;
  symbol: string;
}

const autoScroll = throttle(150, (ctrl: PuzzleCtrl, el: HTMLElement) => {
  const cont = el.parentNode as HTMLElement;
  const target = el.querySelector<HTMLElement>('.active');
  if (!target) {
    cont.scrollTop = ctrl.path === treePath.root ? 0 : 99999;
    return;
  }
  const targetOffset = target.getBoundingClientRect().y - el.getBoundingClientRect().y;
  cont.scrollTop = targetOffset - cont.offsetHeight / 2 + target.offsetHeight;
});

function renderMove(ctx: Ctx, node: TreeNode, path: string, isMainline: boolean, withIndex: boolean): VNode {
  const classes: Classes = {
    active: path === ctx.ctrl.path,
  };
  if (isMainline) {
    classes.current = path === ctx.ctrl.initialPath;
    classes.hist = node.ply < ctx.ctrl.initialNode.ply;
  }
  if (node.puzzle) classes[node.puzzle] = true;
  return hl('move', { attrs: { p: path }, class: classes }, [
    withIndex && renderTreeIndex(node.ply, true),
    renderMoveContents(node, isMainline),
  ]);
}

const renderGlyph = (glyph: Glyph): VNode => hl('glyph', { attrs: { title: glyph.name } }, glyph.symbol);

function puzzleGlyph(node: TreeNode): MaybeVNode {
  switch (node.puzzle) {
    case 'good':
    case 'win':
      return renderGlyph({ name: i18n.puzzle.bestMove, symbol: '✓' });
    case 'fail':
      return renderGlyph({
        name: 'Puzzle failed', //puzzleFailed key never worked, it's in learn/*.xml
        symbol: '✗',
      });
    case 'retry':
      return renderGlyph({ name: i18n.puzzle.goodMove, symbol: '?!' });
    default:
      return undefined;
  }
}

function renderMoveContents(node: TreeNode, isMainline: boolean): LooseVNodes {
  const ev = node.eval || node.ceval;
  return [
    node.san,
    isMainline &&
      ev &&
      (defined(ev.cp) ? renderEval(normalizeEval(ev.cp)) : defined(ev.mate) && renderEval('#' + ev.mate)),
    puzzleGlyph(node),
  ];
}

function renderEval(e: string): VNode {
  return hl('eval', e);
}

function eventPath(e: Event): TreePath | null {
  const target = e.target as HTMLElement;
  return target.getAttribute('p') || (target.parentNode as HTMLElement).getAttribute('p');
}

export function render(ctrl: PuzzleCtrl): VNode {
  const root = ctrl.tree.root;
  return renderColumnTree({
    root,
    renderMove: (node, context) =>
      renderMove({ ctrl, showComputer: false }, node, context.path, context.isMainline, context.withIndex),
    hooks: {
      ...onInsert(el => {
        if (ctrl.path !== treePath.root) autoScroll(ctrl, el);
        el.addEventListener('mousedown', (e: MouseEvent) => {
          if (defined(e.button) && e.button !== 0) return; // only touch or left click
          const path = eventPath(e);
          if (path) ctrl.userJump(path);
          ctrl.redraw();
        });
      }),
      postpatch: (_, vnode) => {
        if (ctrl.autoScrollNow) {
          autoScroll(ctrl, vnode.elm as HTMLElement);
          ctrl.autoScrollNow = false;
          ctrl.autoScrollRequested = false;
        } else if (ctrl.autoScrollRequested) {
          if (ctrl.path !== treePath.root) autoScroll(ctrl, vnode.elm as HTMLElement);
          ctrl.autoScrollRequested = false;
        }
      },
    },
  });
}
