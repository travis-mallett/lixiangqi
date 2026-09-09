// these statements are wrapped in an iife and injected into the html body
// after the DOM as an inline <script>. no imports allowed here.

if (!window.site) window.site = {} as Site;
if (!window.site.load)
  window.site.load = new Promise<void>(function (resolve) {
    document.addEventListener('DOMContentLoaded', function () {
      resolve();
    });
  });

// Shared by full pages and minimal embeds, before any board module starts.
// Keep the old set visible while loading a replacement; commit all its CSS
// variables together only after every face and both shadow textures decode.
if (!window.site.pieceImages) {
  const body = document.body;
  const style = window.getComputedStyle(body);
  const initial = Object.fromEntries(
    ['red', 'black'].flatMap(color =>
      ['soldier', 'elephant', 'horse', 'chariot', 'advisor', 'cannon', 'general'].map(role => {
        const variable = `---${color}-${role}`;
        return [variable, style.getPropertyValue(variable).trim()];
      }),
    ),
  );
  const shadows = ['--xiangqi-rest-shadow-image', '--xiangqi-airborne-shadow-image'].map(variable =>
    style.getPropertyValue(variable).trim(),
  );
  const decoded = new Map<string, Promise<HTMLImageElement>>();
  let requested = '';
  let version = 0;
  let pending: Promise<void>;

  function decode(value: string): Promise<HTMLImageElement> {
    const source = /^url\((['"]?)(.*?)\1\)$/.exec(value)?.[2];
    if (!source) return Promise.reject(new Error(`Invalid piece image: ${value}`));
    let result = decoded.get(source);
    if (!result) {
      const image = new Image();
      image.src = source.replace(/\\(.)/g, '$1');
      result = image.decode().then(
        () => image,
        error => {
          decoded.delete(source);
          throw error;
        },
      );
      decoded.set(source, result);
    }
    return result;
  }

  function set(assets: Record<string, string>, key: string): Promise<void> {
    const entries = Object.entries(assets).sort(([a], [b]) => a.localeCompare(b));
    const signature = JSON.stringify([key, entries]);
    if (signature === requested) return pending;
    requested = signature;
    const current = ++version;
    pending = Promise.all([...entries.map(([, value]) => value), ...shadows].filter(Boolean).map(decode))
      .then(() => {
        if (current !== version) return;
        for (const [variable, value] of entries) body.style.setProperty(variable, value);
        body.dataset.pieceSet = key;
        body.classList.add('piece-images-ready');
      })
      .catch(error => {
        if (current === version) requested = '';
        throw error;
      });
    return pending;
  }

  const ready = set(initial, body.dataset.pieceSet || '');
  window.site.pieceImages = { ready, set };
  void ready.catch(console.error);
}
