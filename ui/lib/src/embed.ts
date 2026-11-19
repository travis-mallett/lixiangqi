/** Minimal embeds have asset metadata, but do not load site.ts or its manifest. */
export const embedAssetUrl = (path: string): string =>
  `${document.body.dataset.assetUrl || ''}/assets/_${document.body.dataset.assetVersion}/${path}`;

/** Same-origin, content-sized embeds opt in through their hosting iframe. */
export function sizeEmbedToContent(element: HTMLElement): boolean {
  const frame = window.frameElement as HTMLIFrameElement | null;
  if (frame?.tagName !== 'IFRAME' || !frame.hasAttribute('data-content-sized')) return false;
  if (frame.hasAttribute('data-theme-embed')) copyBoardColors(frame.ownerDocument, document);
  document.documentElement.classList.add('content-sized-embed');
  const observer = new ResizeObserver(() => {
    frame.style.height = `${Math.ceil(element.getBoundingClientRect().height)}px`;
  });
  observer.observe(element);
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  return true;
}

/** Apply appearance in place, including to lazy frames that are still loading. */
export function updateThemeEmbeds(apply: (doc: Document) => void): void {
  document.querySelectorAll<HTMLIFrameElement>('iframe[data-theme-embed]').forEach(frame => {
    if (new URL(frame.src).origin !== window.location.origin) return;
    const update = () => {
      const doc = frame.contentDocument;
      if (doc?.body && doc.URL !== 'about:blank') apply(doc);
    };
    frame.onload = update;
    update();
  });
}
/** Same-origin TV embeds inherit live color sliders without restarting their streams. */
function copyBoardColors(source: Document, target: Document): void {
  const style = source.defaultView!.getComputedStyle(source.body);
  for (const key of ['brightness', 'contrast', 'saturation', 'opacity', 'hue'])
    target.body.style.setProperty(`---board-${key}`, style.getPropertyValue(`---board-${key}`));
  target.body.classList.toggle('simple-board', source.body.classList.contains('simple-board'));
}

export function updateBoardColorEmbeds(): void {
  document.querySelectorAll<HTMLIFrameElement>('iframe[data-theme-embed]').forEach(frame => {
    if (new URL(frame.src).origin !== window.location.origin) return;
    if (frame.contentDocument?.body) copyBoardColors(document, frame.contentDocument);
  });
}
