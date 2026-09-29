import { loadViewerTree, type ViewerSource } from './model';
import { GameViewer, type ViewerOptions, type ViewerLabels } from './viewer';

export function websiteViewerLabels(): ViewerLabels {
  return {
    first: i18n.site.first,
    previous: i18n.site.previous,
    next: i18n.site.next,
    last: i18n.site.last,
    flip: i18n.site.flipBoard,
    board: i18n.site.board,
    pieces: i18n.site.pieceSet,
    sound: i18n.site.sound,
    moves: i18n.site.moves,
    start: i18n.site.start,
    analysis: i18n.site.analysis,
  };
}

export async function mountViewer(
  element: HTMLElement,
  source: ViewerSource,
  options: Omit<ViewerOptions, 'root' | 'labels' | 'services'> &
    Partial<Pick<ViewerOptions, 'labels' | 'services'>> = {},
  signal?: AbortSignal,
): Promise<GameViewer> {
  const root = await loadViewerTree(source, signal);
  if (signal?.aborted) throw signal.reason;
  return new GameViewer(element, {
    ...options,
    root,
    initialPly: options.initialPly ?? source.initialPly,
    labels: options.labels ?? websiteViewerLabels(),
    services: options.services ?? {
      assetUrl: path => site.asset.url(path),
      reducedMotion: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
      sound: cue =>
        site.sound.move({
          capture: cue.effects.includes('capture'),
          check: cue.effects.includes('check'),
          mate: cue.effects.includes('checkmate'),
        }),
    },
  });
}
