export function syncProfileNavigation(doc: Document, path: string, baseUrl: string): void {
  const pageTitle = doc.querySelector<HTMLElement>('.angle-content [data-page-title]')?.dataset.pageTitle;
  if (pageTitle) doc.title = pageTitle;

  const signIn = doc.querySelector<HTMLAnchorElement>('.signin');
  if (!signIn) return;

  const signInUrl = new URL(signIn.href, baseUrl);
  signInUrl.searchParams.set('referrer', new URL(path, baseUrl).pathname);
  signIn.href = signInUrl.toString();
}
