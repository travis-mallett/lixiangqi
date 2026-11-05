/** Minimal embeds have asset metadata, but do not load site.ts or its manifest. */
export const embedAssetUrl = (path: string): string =>
  `${document.body.dataset.assetUrl || ''}/assets/_${document.body.dataset.assetVersion}/${path}`;

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
