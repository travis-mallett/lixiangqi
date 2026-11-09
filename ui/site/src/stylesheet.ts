const pending = new WeakMap<HTMLLinkElement, Promise<void>>();

/** Concurrent callers must wait for the same stylesheet, including server-rendered links. */
export function loadStylesheet(href: string, key?: string): Promise<void> {
  const absolute = new URL(href, document.baseURI).href;
  const existing = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).find(
    link => link.href === absolute,
  );
  if (existing?.sheet) return Promise.resolve();
  if (existing && pending.has(existing)) return pending.get(existing)!;

  const link = existing ?? document.createElement('link');
  const promise = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      link.removeEventListener('load', loaded);
      link.removeEventListener('error', failed);
      pending.delete(link);
    };
    const loaded = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      link.remove();
      reject(new Error(`Stylesheet failed to load: ${absolute}`));
    };
    link.addEventListener('load', loaded);
    link.addEventListener('error', failed);
  });
  pending.set(link, promise);
  if (!existing) {
    link.rel = 'stylesheet';
    link.href = absolute;
    if (key) link.dataset.cssKey = key;
    document.head.append(link);
  }
  return promise;
}
