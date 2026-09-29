import type { BoardMark, BoardView } from '@lixiangqi/board';

/** Each board owns its pointer tracking; destroying one board cannot affect another. */
export function initModule({ board, redraw }: { board: BoardView; redraw: Redraw }) {
  let pointer = { x: 0.5, y: 0.5 };
  let frame: number | undefined;
  const move = (event: MouseEvent) => {
    const bounds = board.element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    pointer = {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };
    if (frame === undefined)
      frame = requestAnimationFrame(() => {
        frame = undefined;
        redraw();
      });
  };
  document.addEventListener('mousemove', move);
  board.onDestroy(() => {
    document.removeEventListener('mousemove', move);
    if (frame !== undefined) cancelAnimationFrame(frame);
  });
  return {
    makeGooglyShapes: (): BoardMark[] => {
      const {
        geometry: { columns, rows },
        participants,
      } = board.getDefinition();
      const reverse = board.getPresentation().perspective !== participants[0];
      return [...board.position().pieces].flatMap(([location, piece]) => {
        if (piece.face !== 'up' || piece.role !== 'horse') return [];
        const file = location.charCodeAt(0) - 97,
          rank = Number(location.slice(1)) - 1;
        const x = (reverse ? columns - file - 0.5 : file + 0.5) / columns;
        const y = (reverse ? rank + 0.5 : rows - rank - 0.5) / rows;
        const length = Math.hypot(pointer.x - x, pointer.y - y) || 1;
        const dx = (4 * (pointer.x - x)) / length,
          dy = (4 * (pointer.y - y)) / length;
        return [
          {
            from: location,
            svg: [39, 61]
              .map(
                eye =>
                  `<circle cx="${eye}" cy="35" r="9" fill="white" stroke="#333" stroke-width="1.5"/>` +
                  `<circle cx="${eye + dx}" cy="${35 + dy}" r="5" fill="#222"/>`,
              )
              .join(''),
          },
        ];
      });
    },
  };
}
