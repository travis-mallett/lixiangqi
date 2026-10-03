import { prop, type Prop, requestIdleCallbackSafe } from 'lib';
import { winningChances, type CustomCeval } from 'lib/ceval';
import type { XiangqiSide as Color } from 'lib/game/xiangqi';
import { storedBooleanPropWithEffect } from 'lib/storage';
import { path as treePath } from 'lib/tree/tree';
import type { TreeNode, TreePath } from 'lib/tree/types';

import type AnalyseCtrl from '@/ctrl';

import { renderCustomPearl, renderCustomStatus } from './practiceView';

declare type Verdict = 'goodMove' | 'inaccuracy' | 'mistake' | 'blunder';

export interface Comment {
  prev: TreeNode;
  node: TreeNode;
  path: TreePath;
  verdict: Verdict;
  best?: {
    uci: Uci;
    notation: San;
  };
}

interface Hinting {
  mode: 'move' | 'piece';
  uci: Uci;
}

export interface PracticeCtrl {
  onCeval(): void;
  onJump(): void;
  isMyTurn(): boolean;
  comment: Prop<Comment | null>;
  running: Prop<boolean>;
  hovering: Prop<{ uci: string } | null>;
  hinting: Prop<Hinting | null>;
  resume(): void;
  reset(): void;
  preUserJump(from: TreePath, to: TreePath): void;
  postUserJump(from: TreePath, to: TreePath): void;
  onUserMove(): void;
  playCommentBest(): void;
  commentShape(enable: boolean): void;
  hint(): void;
  currentNode(): TreeNode;
  bottomColor(): Color;
  customCeval: CustomCeval;
  redraw: Redraw;
}

export function make(root: AnalyseCtrl): PracticeCtrl {
  const masteryMode = storedBooleanPropWithEffect('analyse.practice-hard-mode', false, root.redraw);
  const running = prop(true),
    comment = prop<Comment | null>(null),
    hovering = prop<{ uci: string } | null>(null),
    hinting = prop<Hinting | null>(null),
    played = prop(false);

  function commentable(node: TreeNode): boolean {
    if (node.outcome()) return true;
    if (!node.ceval) return false;
    const { bestmove, nodes, millis } = node.ceval;
    return Boolean(bestmove || nodes >= 400_000 || (millis ?? 0) > 1000);
  }

  function playable(node: TreeNode): boolean {
    if (!node.ceval) return false;
    const { bestmove, nodes, millis, cloud } = node.ceval;
    return masteryMode()
      ? !root.ceval.isComputing
      : Boolean(bestmove || nodes >= 600_000 || cloud || millis > 2000);
  }

  const nodeBestUci = (node: TreeNode): Uci | undefined => node.ceval?.pvs[0].moves[0];

  function makeComment(prev: TreeNode, node: TreeNode, path: TreePath): Comment {
    let verdict: Verdict, best: Uci | undefined;
    const outcome = node.outcome();

    if (outcome?.winner)
      verdict = root.study && outcome.winner !== root.bottomColor() ? 'blunder' : 'goodMove';
    else {
      const nodeEval: EvalScore = outcome && !outcome.winner ? { cp: 0 } : (node.ceval as EvalScore);
      const prevEval: EvalScore = prev.ceval!;
      const shift = -winningChances.povDiff(root.bottomColor(), nodeEval, prevEval);

      best = nodeBestUci(prev);
      if (best === node.uci) best = undefined;

      if (!best) verdict = 'goodMove';
      else if (shift < 0.025) verdict = 'goodMove';
      else if (shift < 0.06) verdict = 'inaccuracy';
      else if (shift < 0.14) verdict = 'mistake';
      else verdict = 'blunder';
    }

    return {
      prev,
      node,
      path,
      verdict,
      best: best
        ? {
            uci: best,
            notation: prev.children.find(child => child.uci === best)?.notation ?? best,
          }
        : undefined,
    };
  }

  const isMyTurn = (): boolean => root.turnColor() === root.bottomColor();

  function checkCeval() {
    const node = root.node;
    if (!running()) {
      comment(null);
      return root.redraw();
    }
    if (isMyTurn()) {
      const h = hinting();
      if (h) {
        h.uci = nodeBestUci(node) || h.uci;
        root.setAutoShapes();
      }
    } else {
      comment(null);
      if (node.notation && commentable(node)) {
        const parentNode = root.tree.parentNode(root.path);
        if (commentable(parentNode)) comment(makeComment(parentNode, node, root.path));
        else {
          /*
           * Looks like the parent node didn't get enough analysis time
           * to be commentable :-/ it can happen if the player premoves
           * or just makes a move before the position is sufficiently analysed.
           * In this case, fall back to comparing to the position before,
           * Since computer moves are supposed to preserve eval anyway.
           */
          const olderNode = root.tree.parentNode(treePath.init(root.path));
          if (commentable(olderNode)) comment(makeComment(olderNode, node, root.path));
        }
      }
      if (!played() && playable(node)) {
        root.playUci(nodeBestUci(node)!);
        played(true);
      } else root.redraw();
    }
  }

  function resume() {
    running(true);
    checkCeval();
  }

  requestIdleCallbackSafe(checkCeval, 800);

  return {
    onCeval: checkCeval,
    onJump() {
      played(false);
      hinting(null);
      checkCeval();
    },
    isMyTurn,
    comment,
    running,
    hovering,
    hinting,
    resume,
    reset() {
      comment(null);
      hinting(null);
    },
    preUserJump(from: TreePath, to: TreePath) {
      if (from !== to) {
        running(false);
        comment(null);
      }
    },
    postUserJump(from: TreePath, to: TreePath) {
      if (from !== to && isMyTurn()) resume();
    },
    onUserMove() {
      running(true);
    },
    playCommentBest() {
      const c = comment();
      if (!c) return;
      root.jump(treePath.init(c.path));
      if (c.best) root.playUci(c.best.uci);
    },
    commentShape(enable: boolean) {
      const c = comment();
      if (!enable || !c?.best) hovering(null);
      else
        hovering({
          uci: c.best.uci,
        });
      root.setAutoShapes();
    },
    hint() {
      const best = root.node.ceval ? root.node.ceval.pvs[0].moves[0] : null,
        prev = hinting();
      if (!best || prev?.mode === 'move') hinting(null);
      else
        hinting({
          mode: prev ? 'move' : 'piece',
          uci: best,
        });
      root.setAutoShapes();
    },
    currentNode: () => root.node,
    bottomColor: root.bottomColor,
    redraw: root.redraw,
    customCeval: {
      search: () =>
        masteryMode() && !isMyTurn()
          ? 60 * 1000
          : { by: { nodes: 600_000 }, multiPv: 1, indeterminate: true },
      pearlNode: () => renderCustomPearl(root, masteryMode()),
      statusNode: () => (root.ceval.isComputing ? undefined : renderCustomStatus(root, masteryMode)),
    },
  };
}
