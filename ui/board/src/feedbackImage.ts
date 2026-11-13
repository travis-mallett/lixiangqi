// Cache compressed bytes, never a running/finished animated image decoder.
const assets = new WeakMap<Document, Map<string, Promise<Blob>>>();

export function feedbackImageAsset(document: Document, url: string): Promise<Blob> {
  let cache = assets.get(document);
  if (!cache) assets.set(document, (cache = new Map()));
  let asset = cache.get(url);
  if (!asset) {
    asset = fetch(new URL(url, document.baseURI), { signal: AbortSignal.timeout(10_000) })
      .then(response => {
        if (!response.ok) throw new Error(`Board feedback image: HTTP ${response.status}`);
        return response.blob();
      })
      .catch(error => {
        cache.delete(url);
        throw error;
      });
    cache.set(url, asset);
  }
  return asset;
}

/** A presentation owns its decoder identity, load handlers, timer and object URL. */
export function playFeedbackImage(element: HTMLImageElement, url: string, duration: number): () => void {
  let disposed = false;
  let objectUrl: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    element.onload = element.onerror = null;
    element.removeAttribute('src');
    const parent = element.parentElement;
    element.remove();
    if (parent && !parent.childElementCount) parent.remove();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
  element.onload = () => {
    clearTimeout(timer);
    // Network and initial decoding must not consume the visible playback time.
    timer = setTimeout(dispose, duration);
  };
  element.onerror = () => {
    assets.get(element.ownerDocument)?.delete(url);
    dispose();
  };
  // Bound failed/stalled image decoding as well as the shared network request.
  timer = setTimeout(dispose, 15_000);
  void feedbackImageAsset(element.ownerDocument, url).then(blob => {
    if (disposed) return;
    // Fragments do not isolate animated-image state in browser image caches.
    // A fresh object URL gives every playback (including another board) its own decoder.
    objectUrl = URL.createObjectURL(blob);
    element.src = objectUrl;
  }, dispose);
  return dispose;
}
