import { url as assetUrl } from 'lib/assetUrl';
import type { ImportedTreeNode, RulesState } from 'lib/game/xiangqiNotation';

import { type ViewerSource } from './model';
import { mountViewer } from './mount';
import { type ViewerLabels, type GameViewer } from './viewer';

interface EmbedOptions extends ViewerSource {
  labels: ViewerLabels;
  orientation?: 'red' | 'black';
  boardTheme?: string;
  pieceSet?: string;
  ruleset: string;
  states?: RulesState[];
  notations?: string[];
  chineseNotations?: string[];
  gamebook?: { url: string };
  explorerEndpoint?: string;
}

/* A hosting page sizes the iframe, so the embed reports the height of its rendered content
   whenever the layout changes. Hosts that ignore the message keep their own fixed size. */
function reportEmbedHeight(signal: AbortSignal): () => void {
  const post = () => {
    if (window.parent === window || signal.aborted) return;
    const height = Math.ceil(document.body.getBoundingClientRect().height);
    if (height > 0) window.parent.postMessage({ type: 'xiangqi-embed:height', height }, '*');
  };
  if (window.parent === window) return post;
  window.addEventListener('pageshow', post, { signal });
  window.addEventListener('resize', post, { signal });
  if (!window.ResizeObserver) return post;
  const observer = new window.ResizeObserver(post);
  observer.observe(document.body);
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  return post;
}

export async function initModule(options: EmbedOptions): Promise<void> {
  const root = document.querySelector<HTMLElement>('#xiangqi-embed');
  if (!root) return;
  let viewer: GameViewer | undefined;
  const abort = new AbortController();
  const postHeight = reportEmbedHeight(abort.signal);
  window.addEventListener(
    'pagehide',
    event => {
      if (event.persisted) return;
      abort.abort();
      viewer?.destroy();
    },
    { signal: abort.signal },
  );
  try {
    let source: ViewerSource = options;
    const hash = location.hash.slice(1);
    const hasExample = /^(?:%7b|\{)/i.test(hash);
    if (hasExample) {
      if (hash.length > 1500000) throw new Error('Example is too large');
      const decoded = JSON.parse(decodeURIComponent(hash));
      // Only content is accepted from a hosting website. Services, URLs, and executable options remain local.
      source = {
        initialFen: decoded.initialFen,
        moves: decoded.moves,
        pgn: decoded.pgn,
        initialPly: decoded.initialPly,
        annotations: decoded.annotations,
        marks: decoded.marks,
        caption: decoded.caption,
      };
    } else if (hash) source = { ...source, initialPly: hash === 'last' ? 'last' : Number(hash) || 0 };
    if (!hasExample && options.states?.length && options.moves) {
      if (options.states.length !== options.moves.length + 1) throw new Error('Inconsistent recorded game');
      let children: ImportedTreeNode[] = [];
      for (let i = options.moves.length - 1; i >= 0; i--)
        children = [
          {
            move: options.moves[i],
            notation: options.notations?.[i] || options.moves[i],
            chineseNotation: options.chineseNotations?.[i],
            state: options.states[i + 1],
            children,
            annotations: { comments: [], shapes: [] },
          },
        ];
      source = {
        ...source,
        tree: {
          initialFen: options.states[0].fen,
          ruleset: options.ruleset,
          annotations: { comments: [], shapes: [] },
          state: options.states[0],
          children,
        },
      };
    }
    let updateExplorer: ((node: import('./model').ViewerNode) => void) | undefined;
    viewer = await mountViewer(
      root,
      source,
      {
        ...options,
        initialPly: source.initialPly,
        labels: options.labels,
        showMoves: !options.gamebook,
        showControls: !options.gamebook,
        services: {
          assetUrl,
          reducedMotion: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
        },
        onPosition: node => updateExplorer?.(node),
      },
      abort.signal,
    );
    if (abort.signal.aborted) {
      viewer.destroy();
      return;
    }
    if (
      viewer.position().node?.state.variant === 'xiangqi' &&
      options.explorerEndpoint &&
      new URLSearchParams(location.search).get('explorer') === '1'
    ) {
      const { attachExplorer } = await import('./explorer');
      if (abort.signal.aborted) return;
      updateExplorer = attachExplorer(viewer, options.explorerEndpoint, options.labels.analysis);
      updateExplorer(viewer.position());
    }
    if (options.gamebook) {
      const link = document.createElement('a');
      link.textContent = options.labels.start;
      link.href = options.gamebook.url;
      link.target = '_blank';
      link.rel = 'noopener';
      root.append(link);
    }
  } catch (error) {
    if (!abort.signal.aborted) root.textContent = String(error);
  } finally {
    // A lazy iframe can mount before the browser starts delivering resize observations.
    postHeight();
  }
}
