export interface AnalysisLayoutElements {
  page: HTMLElement;
  engine: HTMLElement;
  panel: HTMLElement;
  board: HTMLElement;
}

/** Keep the engine module beside the board on desktop and above it on mobile. */
export function syncAnalysisLayout(
  { page, engine, panel, board }: AnalysisLayoutElements,
  mobile: boolean,
): void {
  if (mobile) {
    if (engine.parentElement !== page) page.insertBefore(engine, board);
  } else if (engine.parentElement !== panel) panel.prepend(engine);
}
