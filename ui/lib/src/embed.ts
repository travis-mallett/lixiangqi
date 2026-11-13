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

/** Refresh opt-in embeds only when their appearance parameters actually change. */
export function updateThemeEmbeds(theme: { uiTheme: string; boardTheme: string; pieceSet: string }): void {
  document.querySelectorAll<HTMLIFrameElement>('iframe[data-theme-embed]').forEach(frame => {
    const url = new URL(frame.src);
    if (url.origin !== window.location.origin) return;
    let changed = false;
    for (const [key, value] of Object.entries(theme)) {
      if (url.searchParams.get(key) === value) continue;
      url.searchParams.set(key, value);
      changed = true;
    }
    if (changed) frame.src = url.href;
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
