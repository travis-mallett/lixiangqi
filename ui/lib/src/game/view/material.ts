import { h, type VNode } from 'snabbdom';

import { getMaterialDiff, getScore, type MaterialDiffSide } from '../material';

function renderMaterialDiff(
  material: MaterialDiffSide,
  score: number,
  position: 'top' | 'bottom',
  color: 'red' | 'black',
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
  if (score > 0) children.push(h('score', '+' + score));
  return h('div.material.material-' + position, children);
}

export function renderMaterialDiffs(
  showCaptured: boolean,
  bottomColor: 'red' | 'black',
  fen: FEN,
): [VNode, VNode] {
  const material = getMaterialDiff(showCaptured ? fen : '');
  const score = getScore(material) * (bottomColor === 'black' ? -1 : 1);
  const top = bottomColor === 'red' ? 'black' : 'red';
  const bottom = bottomColor;
  return [
    renderMaterialDiff(material[top], -score, 'top', top),
    renderMaterialDiff(material[bottom], score, 'bottom', bottom),
  ];
}
