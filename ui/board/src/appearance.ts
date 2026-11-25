import type { BoardView } from './board';
import type { BoardDefinition } from './types';

// Match CSS image requests (including their credentials mode) in the owning
// document. A list of boards using the same theme shares each decode.
const decoded = new WeakMap<Document, Map<string, Promise<HTMLImageElement>>>();

export async function preloadBoardImages(doc: Document, images: readonly string[]): Promise<void> {
  let cache = decoded.get(doc);
  if (!cache) decoded.set(doc, (cache = new Map()));
  await Promise.all(
    images.map(value => {
      const match = /^url\((['"]?)(.*?)\1\)$/.exec(value.trim());
      if (!match) throw new Error(`Invalid board image: ${value}`);
      const url = new URL(match[2].replace(/\\(.)/g, '$1'), doc.baseURI).href;
      let pending = cache.get(url);
      if (!pending) {
        const image = doc.createElement('img');
        image.src = url;
        pending = image.decode().then(
          () => image,
          error => {
            cache.delete(url);
            throw error;
          },
        );
        cache.set(url, pending);
      }
      return pending;
    }),
  );
}

function boardImageVariables(definition: BoardDefinition): string[] {
  const family = definition.pieceFamily ?? definition.id;
  const prefix = family === 'xiangqi' ? '---' : `---${family}-`;
  return [
    `---board-image-${definition.geometry.id}`,
    '--xiangqi-rest-shadow-image',
    '--xiangqi-airborne-shadow-image',
    ...(definition.id === 'banqi' ? ['--board-piece-back-neutral'] : []),
    ...definition.participants.flatMap(side => [
      `--board-piece-back-${side}`,
      ...Object.keys(definition.roles).map(role => `${prefix}${side}-${role}`),
    ]),
  ];
}

// Preferences publish all their decoded URLs together. Notify boards whose
// first appearance is still waiting (including a failed or stalled request).
const appearanceChanged = 'board-appearance-loaded';
const selections = new WeakMap<Document, object>();

export async function applyBoardAppearance(
  doc: Document,
  images: Record<string, string>,
  board: string,
  pieces: string,
  styles: Record<string, string>,
): Promise<boolean> {
  const selection = {};
  selections.set(doc, selection);
  if (doc.body.dataset.board === board && doc.body.dataset.pieceSet === pieces) return true;
  await preloadBoardImages(doc, Object.values(images));
  if (selections.get(doc) !== selection) return false;
  for (const [key, value] of Object.entries({ ...images, ...styles })) doc.body.style.setProperty(key, value);
  doc.body.dataset.board = board;
  doc.body.dataset.pieceSet = pieces;
  doc.dispatchEvent(new doc.defaultView!.Event(appearanceChanged));
  return true;
}

export function revealBoardWhenReady(board: BoardView): void {
  const { element } = board;
  const doc = element.ownerDocument;
  const variables = boardImageVariables(board.getDefinition());
  if (board.getDefinition().coordinateImage) variables.push('--board-coordinate-image');
  let generation = 0;
  let attachment: MutationObserver | undefined;
  const stop = () => {
    generation++;
    attachment?.disconnect();
    doc.removeEventListener(appearanceChanged, prepare);
  };
  const prepare = () => {
    if (!element.isConnected) return;
    attachment?.disconnect();
    const current = ++generation;
    const style = doc.defaultView!.getComputedStyle(element);
    const images = variables.map(key => style.getPropertyValue(key).trim());
    // A missing CSS binding cannot produce a complete position. An appearance
    // change can supply it later, just as it can replace a failed image URL.
    if (images.includes('')) return;
    void preloadBoardImages(doc, images).then(
      () => {
        if (current === generation) {
          element.classList.add('board-assets-ready');
          stop();
        }
      },
      error => {
        if (current === generation) console.error('Loading board artwork', error);
      },
    );
  };
  doc.addEventListener(appearanceChanged, prepare);
  board.onDestroy(stop);
  if (element.isConnected) prepare();
  else {
    // Detached viewers and previews acquire their scoped CSS when inserted.
    attachment = new doc.defaultView!.MutationObserver(prepare);
    attachment.observe(doc, { childList: true, subtree: true });
  }
}
