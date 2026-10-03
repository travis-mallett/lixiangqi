import { coordinateMove, type BoardMark } from '@lixiangqi/board';
import { analysisBoardArrows } from 'xiangqi';

import { annotationShapes } from 'lib/game/glyphs';
import type { XiangqiSide as Color } from 'lib/game/xiangqi';

import type AnalyseCtrl from './ctrl';

export function makeShapesFromUci(
  _color: Color,
  uci: string | undefined,
  brush: string,
  modifiers?: { lineWidth?: number },
): BoardMark[] {
  if (!uci || uci === 'Current Position' || uci === '(none)') return [];
  const [from, to] = coordinateMove(uci);
  return [{ from, to, brush, lineWidth: modifiers?.lineWidth }];
}

export function compute(ctrl: AnalyseCtrl): BoardMark[] {
  const color = ctrl.turnColor();
  const mark = (uci: string | undefined, brush: string, width?: number) =>
    makeShapesFromUci(color, uci, brush, { lineWidth: width });
  if (ctrl.practice) {
    const hover = ctrl.practice.hovering();
    if (hover) return mark(hover.uci, 'green');
    const hint = ctrl.practice.hinting();
    if (!hint) return [];
    const shape = mark(hint.uci, 'paleBlue');
    return hint.mode === 'move' ? shape : shape.map(({ from, brush }) => ({ from, brush }));
  }
  const { node } = ctrl;
  let hovering = ctrl.explorer.hovering();
  if (hovering?.fen !== node.fen) {
    ctrl.explorer.hovering(null);
    hovering = ctrl.ceval.hovering();
  }
  ctrl.fork.hover(hovering?.uci);
  const bad = ctrl.retro?.showBadNode();
  if (bad?.uci) return mark(bad.uci, 'paleRed', 8);
  // Engine lines, hover previews, threats and continuations are owned by the
  // shared analysis module so studies, relays and the analysis page cannot
  // drift apart; this board only supplies their state.
  const previewMove = hovering?.fen === node.fen ? hovering.uci : undefined;
  const best = node.eval?.best ?? ctrl.nextNodeBest();
  const engineLines =
    ctrl.isCevalAllowed() && ctrl.showBestMoveArrows() && ctrl.showEvaluation()
      ? node.ceval?.pvs.length
        ? node.ceval.pvs.map(pv => pv.moves)
        : best
          ? [[best]]
          : []
      : [];
  const gamebook = !!(ctrl.study?.data.chapter.gamebook && !ctrl.study.gamebookPlay);
  const children = ctrl.showVariationArrows()
    ? ctrl.visibleChildren().flatMap(child => (child.uci ? [child.uci] : []))
    : [];
  const shapes: BoardMark[] = analysisBoardArrows({
    engineLines,
    turn: color,
    orientation: ctrl.getOrientation(),
    children: gamebook ? [] : children,
    previewMove,
    threatMoves:
      ctrl.isCevalAllowed() && ctrl.threatMode()
        ? node.threat?.pvs.flatMap(pv => (pv.moves[0] ? [pv.moves[0]] : []))
        : [],
  });
  if (ctrl.showMoveAnnotations()) {
    const glyphs = [...(node.glyphs ?? [])];
    const live = ctrl.liveAnnotate.get(ctrl.path);
    if (live && ctrl.settings.showLiveAnnotations && !glyphs.some(glyph => glyph.id <= 6)) glyphs.push(live);
    shapes.push(...annotationShapes({ ...node, glyphs }));
  }
  if (gamebook && children.length > 1)
    children.forEach((child, index) => {
      shapes.push(...mark(child, index === 0 ? 'paleGreen' : 'paleRed'));
    });
  if (ctrl.motifEnabled() && ctrl.motif.any())
    shapes.push(...ctrl.motif.shapes(ctrl.tree.positionAt(ctrl.path)));
  return shapes;
}
