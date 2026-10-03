import { createBoardAudio } from '@lixiangqi/board';

import type { ImportedTreeNode, RulesState } from 'lib/game/xiangqiNotation';

import { attachExplorer } from './explorer';
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
function reportEmbedHeight(element: HTMLElement, signal: AbortSignal): void {
  if (window.parent === window) return;
  const post = () => {
    const height = Math.ceil(document.body.getBoundingClientRect().height);
    if (height > 0) window.parent.postMessage({ type: 'xiangqi-embed:height', height }, '*');
  };
  post();
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', post, { signal });
    return;
  }
  const observer = new ResizeObserver(post);
  observer.observe(element);
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
}

export async function initModule(options: EmbedOptions): Promise<void> {
  const root = document.querySelector<HTMLElement>('#xiangqi-embed')!;
  let viewer: GameViewer | undefined;
  const abort = new AbortController();
  let audio: ReturnType<typeof createBoardAudio> | undefined;
  reportEmbedHeight(root, abort.signal);
  window.addEventListener(
    'pagehide',
    () => {
      abort.abort();
      viewer?.destroy();
      audio?.destroy();
    },
    { once: true },
  );
  try {
    let source: ViewerSource = options;
    const hash = location.hash.slice(1);
    if (hash.startsWith('%7B') || hash.startsWith('{')) {
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
    if (options.states?.length && options.moves) {
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
    const assetUrl = (path: string) =>
      `${document.body.dataset.assetUrl || ''}/assets/_${document.body.dataset.assetVersion}/${path}`;
    audio = createBoardAudio(assetUrl);
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
          sound: audio.sound,
          reducedMotion: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
        },
        onPosition: node => updateExplorer?.(node),
      },
      abort.signal,
    );
    if (options.explorerEndpoint && new URLSearchParams(location.search).get('explorer') === '1') {
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
  }
}
