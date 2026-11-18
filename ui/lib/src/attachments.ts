import { h, type VNode } from 'snabbdom';

import { json, ValidationError } from './xhr';

type Surface = 'msg' | 'forum';
type State = 'uploading' | 'checking' | 'ready' | 'blocked' | 'retry';
type Item = {
  file: File;
  state: State;
  id?: string;
  preview?: string;
  generation: number;
  reviewable?: boolean;
  retained?: boolean;
  size?: number;
};
type Policy = { enabled: boolean; maxCount: number; maxBytes: number };
const accepted = '.jpg,.jpeg,.png,.webp,.txt,.pgn';

export function submissionError(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'unsafeLink') return i18n.site.mediaUnsafeLink;
  if (code === 'privateTextOnly') return i18n.site.mediaTextOnly;
  return i18n.site.mediaUnsent;
}

export class AttachmentDraft {
  readonly items: Item[] = [];
  nonce: string = window.crypto.randomUUID();
  private policy?: Policy;
  private readonly base: string;
  private root?: HTMLElement;
  private redraw?: () => void;
  private abort?: AbortController;
  private next?: ReturnType<typeof setTimeout>;
  private warning = '';
  private readonly viewKey = window.crypto.randomUUID();
  constructor(
    readonly surface: Surface,
    readonly dest: string,
    published: string[] = [],
  ) {
    for (const id of published)
      this.items.push({
        id,
        file: new File([], i18n.site.mediaFiles),
        generation: 0,
        state: 'ready',
        retained: true,
      });
    this.base = '/attachment/' + surface + '/' + encodeURIComponent(dest);
  }
  get ready(): boolean {
    return this.items.every(i => i.state === 'ready');
  }
  get ids(): string[] {
    return this.items.flatMap(i => (i.id ? [i.id] : []));
  }
  get active(): boolean {
    return this.items.length > 0;
  }

  view(field: string, changed: () => void): VNode {
    return h('div.attachment-draft', {
      key: this.viewKey,
      hook: {
        insert: v => {
          void this.mount(
            v.elm as HTMLElement,
            (v.elm as HTMLElement).parentElement!.querySelector(field),
            changed,
          );
        },
        destroy: () => this.unmount(),
      },
    });
  }

  async mount(root: HTMLElement, field: HTMLElement | null, changed: () => void): Promise<void> {
    this.unmount();
    this.root = root;
    this.redraw = changed;
    const abort = (this.abort = new AbortController());
    const { signal } = abort;
    try {
      this.policy = await json<Policy>(this.base + '/policy', { signal });
    } catch {
      return;
    }
    if (!this.policy.enabled || signal.aborted) return;
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'attachment-plus button button-empty';
    plus.textContent = '+';
    plus.setAttribute('aria-label', i18n.site.attachMedia);
    plus.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div');
    menu.className = 'attachment-menu';
    menu.hidden = true;
    const close = () => {
      menu.hidden = true;
      plus.setAttribute('aria-expanded', 'false');
      plus.focus();
    };
    plus.onclick = () => {
      menu.hidden = !menu.hidden;
      plus.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) menu.querySelector('button')?.focus();
    };
    menu.onkeydown = e => {
      if (e.key === 'Escape') close();
    };
    const pick = (label: string, accept: string, camera = false) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = !camera;
      input.hidden = true;
      if (camera) input.setAttribute('capture', 'environment');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button button-empty';
      button.textContent = label;
      button.onclick = () => {
        input.click();
        close();
      };
      input.onchange = () => {
        this.add(Array.from(input.files ?? []));
        input.value = '';
      };
      menu.append(button, input);
    };
    pick(i18n.site.mediaPhotos, 'image/png,image/jpeg,image/webp');
    pick(i18n.site.mediaFiles, accepted);
    if (window.matchMedia('(pointer: coarse)').matches) pick(i18n.site.mediaCamera, 'image/*', true);
    const disclosure = document.createElement('small');
    disclosure.textContent = i18n.site.mediaDisclosure;
    disclosure.className = 'attachment-disclosure';
    const list = document.createElement('div');
    list.className = 'attachment-items';
    list.setAttribute('aria-live', 'polite');
    root.replaceChildren(plus, menu, list);
    if (this.surface === 'msg') root.append(disclosure);
    field?.addEventListener(
      'paste',
      e => {
        const files = Array.from(e.clipboardData?.files ?? []);
        if (files.length) {
          e.preventDefault();
          this.add(files);
        }
      },
      { signal },
    );
    const drop = field?.parentElement ?? root;
    drop.addEventListener(
      'dragover',
      e => {
        if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
      },
      { signal },
    );
    drop.addEventListener(
      'drop',
      e => {
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length) {
          e.preventDefault();
          this.add(files);
        }
      },
      { signal },
    );
    this.render();
    this.poll();
    for (const i of this.items.filter(i => i.retained)) {
      const url = '/attachment/' + this.surface + '/item/' + i.id;
      void json<{ name: string; size: number; mime: string }>(url + '?meta=1', { signal })
        .then(meta => {
          if (signal.aborted) return;
          i.file = new File([], meta.name);
          i.size = meta.size;
          if (meta.mime === 'image/webp') i.preview = url;
          this.render();
        })
        .catch(() => {});
    }
  }

  private add(files: File[]) {
    if (!this.policy?.enabled) return;
    for (const file of files) {
      if (this.items.length >= this.policy.maxCount) {
        this.warning = i18n.site.mediaLimit;
        break;
      }
      const valid =
        file.size > 0 &&
        file.size <= this.policy.maxBytes &&
        /\.(?:jpe?g|png|webp|txt|pgn)$/i.test(file.name);
      const item: Item = { file, generation: 0, state: valid ? 'uploading' : 'blocked' };
      if (valid && /^image\/(jpeg|png|webp)$/.test(file.type)) item.preview = URL.createObjectURL(file);
      this.items.push(item);
      if (valid) void this.upload(item);
    }
    this.render();
  }

  private async upload(i: Item) {
    const serial = ++i.generation;
    i.state = 'uploading';
    this.render();
    try {
      const s = await json<{ id: string; state: State }>(this.base + '/upload', {
        method: 'POST',
        body: i.file,
        signal: AbortSignal.timeout(30000),
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Attachment-Name': encodeURIComponent(i.file.name),
        },
      });
      if (serial !== i.generation) {
        void this.action(s.id, 'remove');
        return;
      }
      i.id = s.id;
      i.state = s.state;
    } catch (e) {
      if (serial === i.generation)
        i.state = e instanceof ValidationError && e.message !== 'scannerUnavailable' ? 'blocked' : 'retry';
    }
    this.render();
    this.poll();
  }

  private action(id: string, action: string) {
    return fetch(this.base + '/draft/' + id + '?action=' + action, {
      method: 'POST',
      credentials: 'same-origin',
    })
      .then(r => r.ok)
      .catch(() => false);
  }

  private poll() {
    if (this.next || !this.root || !this.items.some(i => i.state === 'checking')) return;
    this.next = setTimeout(async () => {
      await Promise.all(
        this.items
          .filter(i => i.id && i.state === 'checking')
          .map(async i => {
            try {
              const status = await json<{ state: State; reviewable?: boolean }>(
                this.base + '/draft/' + i.id,
                { signal: AbortSignal.timeout(15000) },
              );
              i.state = status.state;
              i.reviewable = status.reviewable;
            } catch {
              i.state = 'retry';
            }
          }),
      );
      this.next = undefined;
      this.render();
      this.poll();
    }, 1200);
  }

  private render() {
    const list = this.root?.querySelector('.attachment-items');
    if (!list) return;
    const focus = list.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.action
      : undefined;
    list.replaceChildren();
    this.items.forEach((i, index) => {
      const row = document.createElement('div');
      row.className = 'attachment-item';
      if (i.preview) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = i.preview;
        row.append(img);
      }
      const title = document.createElement('span');
      title.textContent = i.file.name + ' · ' + Math.ceil((i.size ?? i.file.size) / 1024) + ' KiB';
      const state = document.createElement('small');
      state.textContent = {
        uploading: i18n.site.mediaUploading,
        checking: i18n.site.mediaChecking,
        ready: i18n.site.mediaReady,
        blocked: i18n.site.mediaBlocked,
        retry: i18n.site.mediaRetry,
      }[i.state];
      title.append(state);
      row.append(title);
      const button = (name: string, action: string, run: () => void) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'button button-empty';
        el.textContent = name;
        el.dataset.action = action + index;
        el.onclick = run;
        row.append(el);
      };
      if (i.state === 'retry')
        button(i18n.site.mediaRetryAction, 'retry', async () => {
          if (i.id) {
            if (await this.action(i.id, 'retry')) {
              i.state = 'checking';
              this.render();
              this.poll();
            } else this.pollStatus(i);
          } else void this.upload(i);
        });
      if (i.state === 'blocked' && i.id && i.reviewable)
        button(i18n.site.mediaReview, 'review', async () => {
          if (await this.action(i.id!, 'review')) this.pollStatus(i);
        });
      button(i18n.site.mediaRemove, 'remove', () => {
        ++i.generation;
        if (i.id && !i.retained) void this.action(i.id, 'remove');
        if (i.preview && !i.retained) URL.revokeObjectURL(i.preview);
        this.items.splice(index, 1);
        this.warning = '';
        this.render();
        (this.root?.querySelector('.attachment-plus') as HTMLButtonElement)?.focus();
      });
      list.append(row);
    });
    if (this.warning) list.append(document.createTextNode(this.warning));
    if (focus) list.querySelector<HTMLElement>('[data-action="' + focus + '"]')?.focus();
    this.redraw?.();
  }
  private pollStatus(i: Item) {
    i.state = 'checking';
    this.render();
    this.poll();
  }
  accepted(ids: string[]): void {
    for (const item of this.items.filter(i => i.id && ids.includes(i.id))) {
      if (item.preview && !item.retained) URL.revokeObjectURL(item.preview);
      this.items.splice(this.items.indexOf(item), 1);
    }
    this.nonce = window.crypto.randomUUID();
    this.render();
  }
  abandon(): void {
    for (const i of this.items) if (i.id && !i.retained) void this.action(i.id, 'remove');
    this.clear();
    this.unmount();
  }
  clear(): void {
    for (const i of this.items) {
      ++i.generation;
      if (i.preview && !i.retained) URL.revokeObjectURL(i.preview);
    }
    this.items.length = 0;
    this.nonce = window.crypto.randomUUID();
    this.warning = '';
    this.render();
  }
  revoke(): void {
    if (this.policy) this.policy.enabled = false;
    this.root?.replaceChildren();
    this.unmount();
    this.clear();
  }
  unmount(): void {
    this.abort?.abort();
    clearTimeout(this.next);
    this.next = undefined;
    this.root = undefined;
    this.redraw = undefined;
  }
}

let watchPrivateMedia = false;
const loads = new WeakMap<HTMLElement, number>();

export function showMedia(root: HTMLElement, surface: Surface, id: string): void {
  if (!/^[a-f0-9]{32}$/.test(id)) return;
  const generation = (loads.get(root) ?? 0) + 1;
  loads.set(root, generation);
  if (surface === 'msg') {
    root.dataset.privateAttachment = id;
    if (!watchPrivateMedia) {
      watchPrivateMedia = true;
      const refresh = () =>
        document.querySelectorAll<HTMLElement>('[data-private-attachment]').forEach(el => {
          if (document.hidden) {
            loads.set(el, (loads.get(el) ?? 0) + 1);
            el.replaceChildren();
          } else showMedia(el, 'msg', el.dataset.privateAttachment!);
        });
      document.addEventListener('visibilitychange', refresh);
      window.addEventListener('pageshow', refresh);
    }
    if (document.hidden) return;
  }
  const url = '/attachment/' + surface + '/item/' + id;
  void json<{ name: string; mime: string; size: number }>(url + '?meta=1')
    .then(meta => {
      if (!root.isConnected || loads.get(root) !== generation) return;
      const link = document.createElement('a');
      link.href = url;
      link.rel = 'noreferrer';
      link.textContent = meta.name;
      if (meta.mime === 'image/webp') {
        const img = document.createElement('img');
        img.src = url;
        img.alt = meta.name;
        img.loading = 'lazy';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button button-empty';
        button.title = i18n.site.mediaOpen;
        button.setAttribute('aria-expanded', 'false');
        button.onclick = () => {
          const expanded = root.classList.toggle('expanded');
          button.setAttribute('aria-expanded', String(expanded));
        };
        button.append(img);
        root.replaceChildren(button);
        return;
      } else {
        link.download = meta.name;
        link.textContent =
          i18n.site.mediaDownload + ' · ' + meta.name + ' (' + Math.ceil(meta.size / 1024) + ' KiB)';
      }
      root.replaceChildren(link);
    })
    .catch(() => root.replaceChildren());
}
export function mediaView(surface: Surface, id: string): VNode {
  return h('span.published-attachment', {
    key: id,
    hook: { insert: v => showMedia(v.elm as HTMLElement, surface, id) },
  });
}
