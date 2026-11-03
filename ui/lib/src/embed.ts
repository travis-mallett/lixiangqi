/** Minimal embeds have asset metadata, but do not load site.ts or its manifest. */
export const embedAssetUrl = (path: string): string =>
  `${document.body.dataset.assetUrl || ''}/assets/_${document.body.dataset.assetVersion}/${path}`;
