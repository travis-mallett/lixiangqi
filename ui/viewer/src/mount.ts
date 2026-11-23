import { boardDefinition, boardDefinitionForFen } from '@lixiangqi/board';

import { websiteBoardServices } from 'lib/board';
import { websiteCaptureLabels } from 'lib/game/view/captures';

import { prepareViewerAppearance } from './appearance';
import { loadViewerTree, type ViewerSource } from './model';
import { GameViewer, type ViewerOptions, type ViewerLabels } from './viewer';

export function websiteViewerLabels(): ViewerLabels {
  return {
    captures: websiteCaptureLabels(),
    first: i18n.site.first,
    previous: i18n.site.previous,
    next: i18n.site.next,
    last: i18n.site.last,
    moves: i18n.site.moves,
    moveAnnotations: i18n.site.moveAnnotations,
    start: i18n.site.start,
    analysis: i18n.site.analysis,
  };
}

export async function mountViewer(
  element: HTMLElement,
  source: ViewerSource,
  options: Omit<ViewerOptions, 'root' | 'labels' | 'services'> &
    Partial<Pick<ViewerOptions, 'labels' | 'services'>> & { inheritAppearance?: boolean } = {},
  signal?: AbortSignal,
): Promise<GameViewer> {
  const tree = loadViewerTree(source, signal);
  const assetUrl = options.services?.assetUrl ?? (path => site.asset.url(path));
  const prepare = (fen: string) =>
    options.inheritAppearance
      ? undefined
      : prepareViewerAppearance(
          element.ownerDocument,
          source.root?.position.board
            ? boardDefinition(source.root.position.board)
            : boardDefinitionForFen(fen),
          assetUrl,
          options.boardTheme,
          options.pieceSet,
        );
  const fen = source.root?.fen ?? source.tree?.state.fen ?? source.initialFen;
  const [root, applyAppearance] = await Promise.all([
    tree,
    fen ? prepare(fen) : tree.then(root => prepare(root.fen)),
  ]);
  if (signal?.aborted) throw signal.reason;
  applyAppearance?.(element);
  return new GameViewer(element, {
    ...options,
    root,
    initialPly: options.initialPly ?? source.initialPly,
    labels: options.labels ?? websiteViewerLabels(),
    services:
      options.services ??
      (options.inheritAppearance
        ? websiteBoardServices()
        : {
            assetUrl,
            reducedMotion: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
            sound: cue =>
              site.sound.move({
                capture: cue.effects.includes('capture'),
                check: cue.effects.includes('check'),
                mate: cue.effects.includes('checkmate'),
              }),
          }),
  });
}
