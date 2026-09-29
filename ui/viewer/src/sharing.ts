import type { ViewerSource } from './model';

/** Fragments keep externally authored examples out of request logs and require no account or publication. */
export function embedUrl(source: ViewerSource, origin: string = location.origin): string {
  return `${origin}/embed/xiangqi#${encodeURIComponent(JSON.stringify(source))}`;
}

export function embedCode(source: ViewerSource, origin: string = location.origin): string {
  const url = embedUrl(source, origin).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  return `<iframe src="${url}" title="Xiangqi game" loading="lazy" style="width:100%;max-width:640px;height:780px;border:0" allowfullscreen></iframe>`;
}
