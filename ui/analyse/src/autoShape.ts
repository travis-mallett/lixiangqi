import { coordinateMove, type BoardMark } from '@lixiangqi/board';

import { winningChances } from 'lib/ceval';
import { annotationShapes } from 'lib/game/glyphs';

import type AnalyseCtrl from './ctrl';

export function makeShapesFromUci(
  _color: Color,
  uci: string | undefined,
  brush: string,
  modifiers?: { lineWidth?: number },
): BoardMark[] {
  if (!uci || uci === 'Current Position' || uci === '(none)') return [];
  const [from, to] = coordinateMove(uci.replaceAll(':', '10'));
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
  const shapes: BoardMark[] = hovering?.fen === node.fen ? mark(hovering.uci, 'paleBlue') : [];
  if (ctrl.isCevalAllowed() && ctrl.showBestMoveArrows() && ctrl.showEvaluation()) {
    shapes.push(...mark(node.eval?.best, 'paleGreen'));
    if (!hovering && ctrl.ceval.search.multiPv) {
      const pvs = node.ceval?.pvs ?? [];
      const moves = pvs[0]?.moves ?? [ctrl.nextNodeBest()].filter((move): move is string => !!move);
      let previous: string | undefined;
      const occupied = new Set<string>();
      for (let i = 0; i < Math.min(moves.length, ctrl.settings.showManeuverMoveArrows ? 6 : 1); i += 2) {
        const next = mark(moves[i], 'paleBlue')[0];
        if (!next || (previous && next.from !== previous) || occupied.has(next.to!)) break;
        shapes.push(next);
        occupied.add(next.from);
        occupied.add(next.to!);
        previous = next.to;
      }
      pvs.slice(1).forEach(pv => {
        const shift = winningChances.povDiff(color, pvs[0], pv);
        if (shift >= 0 && shift < 0.2)
          shapes.push(...mark(pv.moves[0], 'paleGrey', Math.round(12 - shift * 50)));
      });
    }
  }
  if (ctrl.isCevalAllowed() && ctrl.threatMode())
    node.threat?.pvs.forEach(pv => shapes.push(...mark(pv.moves[0], 'paleRed')));
  if (ctrl.showMoveAnnotations()) {
    const glyphs = [...(node.glyphs ?? [])];
    const live = ctrl.liveAnnotate.get(ctrl.path);
    if (live && ctrl.settings.showLiveAnnotations && !glyphs.some(glyph => glyph.id <= 6)) glyphs.push(live);
    shapes.push(...annotationShapes({ ...node, glyphs }));
  }
  if (ctrl.showVariationArrows()) {
    const children = ctrl.visibleChildren();
    if (children.length > 1)
      children.forEach((child, index) => {
        const gamebook = ctrl.study?.data.chapter.gamebook && !ctrl.study.gamebookPlay;
        shapes.push(
          ...mark(
            child.uci,
            gamebook
              ? index === 0
                ? 'paleGreen'
                : 'paleRed'
              : index === ctrl.fork.selectedIndex
                ? 'paleBlue'
                : 'variation',
          ),
        );
      });
  }
  return shapes;
}
