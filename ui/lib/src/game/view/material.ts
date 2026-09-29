import { opposite } from '@lichess-org/chessground/util';
import { h, type VNode } from 'snabbdom';

import type { CheckCount, CheckState } from '@/game';

import { countChecks, getMaterialDiff, getScore, NO_CHECKS, type MaterialDiffSide } from '../material';

function renderMaterialDiff(
  material: MaterialDiffSide,
  score: number,
  position: 'top' | 'bottom',
  color: 'red' | 'black',
  checks?: number,
): VNode {
  const children: VNode[] = [];
  let role: keyof MaterialDiffSide;
  for (role in material) {
    if (material[role] > 0) {
      const content: VNode[] = [];
      for (let i = 0; i < material[role]; i++) content.push(h(`mpiece.${color}.${role}`));
      children.push(h('div', content));
    }
  }
  if (checks) for (let i = 0; i < checks; i++) children.push(h('div', h(`mpiece.${color}.general`)));
  if (score > 0) children.push(h('score', '+' + score));
  return h('div.material.material-' + position, children);
}

export function renderMaterialDiffs(
  showCaptured: boolean,
  bottomColor: Color,
  fen: FEN,
  showChecks: boolean,
  checkStates: CheckState[],
  ply: Ply,
): [VNode, VNode] {
  const material = getMaterialDiff(showCaptured ? fen : '');
  const score = getScore(material) * (bottomColor === 'white' ? 1 : -1);
  const checks: CheckCount = showChecks ? countChecks(checkStates, ply) : NO_CHECKS;
  const topColor = opposite(bottomColor);
  const top = topColor === 'white' ? 'red' : 'black';
  const bottom = bottomColor === 'white' ? 'red' : 'black';
  return [
    renderMaterialDiff(material[top], -score, 'top', top, checks[topColor]),
    renderMaterialDiff(material[bottom], score, 'bottom', bottom, checks[bottomColor]),
  ];
}
