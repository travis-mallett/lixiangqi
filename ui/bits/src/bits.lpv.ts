import { mountViewer, type GameViewer, type ViewerOptions } from '@lixiangqi/viewer';

import { text as xhrText } from 'lib/xhr';

type Options = Pick<ViewerOptions, 'orientation' | 'initialPly' | 'showMoves' | 'showControls'>;
const mounted = new Map<HTMLElement, { abort: AbortController; viewer?: GameViewer }>();
let observer: MutationObserver | undefined;

async function mount(el: HTMLElement, pgn: string, options: Options): Promise<void> {
  if (mounted.has(el)) return;
  const entry: { abort: AbortController; viewer?: GameViewer } = { abort: new AbortController() };
  mounted.set(el, entry);
  observer ??= new MutationObserver(() => {
    for (const [element, entry] of mounted)
      if (!element.isConnected) {
        entry.abort.abort();
        entry.viewer?.destroy();
        mounted.delete(element);
      }
    if (!mounted.size) {
      observer?.disconnect();
      observer = undefined;
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  try {
    entry.viewer = await mountViewer(el, { pgn }, options, entry.abort.signal);
  } catch (error) {
    if (!entry.abort.signal.aborted) el.textContent = String(error);
  }
}

/** Retain stored forum/message markup; all actual rendering is the native shared viewer. */
export default async function (opts?: { el: HTMLElement; url: string; lpvOpts: Options }): Promise<void> {
  await site.asset.loadCssPath('bits.lpv');
  if (opts)
    return mount(
      opts.el,
      await xhrText(opts.url, { headers: { Accept: 'application/x-chess-pgn' } }),
      opts.lpvOpts,
    );
  await Promise.all(
    [...document.querySelectorAll<HTMLElement>('.lpv--autostart')].map(el => {
      const rawPly = el.dataset.ply;
      return mount(el, (el.dataset.pgn ?? '').replace(/<br>/g, '\n'), {
        orientation: el.dataset.orientation === 'black' ? 'black' : 'red',
        initialPly: rawPly === 'last' ? 'last' : rawPly === undefined ? 'last' : Number(rawPly) || 0,
      });
    }),
  );
}
