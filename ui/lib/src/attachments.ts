import { h, type VNode } from 'snabbdom';

import { json, ValidationError } from './xhr';

type Surface = 'msg' | 'forum';
type State = 'local' | 'uploading' | 'checking' | 'ready' | 'blocked' | 'retry';
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
  private editing?: Item;
  private settle?: () => void;
  private pickPhotos?: () => void;
  private warning = '';
  private readonly viewKey = window.crypto.randomUUID();
  constructor(
    readonly surface: Surface,
    readonly dest: string,
    published: string[] = [],
    private readonly editPhoto?: (file: File, signal: AbortSignal) => Promise<File | undefined>,
    private readonly pickerIcon?: (name: 'plus' | 'photo' | 'file' | 'contact' | 'poll') => HTMLElement,
    private readonly compose?: (type: 'poll' | 'contact') => void,
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
    return !this.editing && this.items.every(i => i.state === 'ready' || i.state === 'local');
  }
  async prepare(): Promise<boolean> {
    const selected = this.items.slice();
    const local = selected.filter(i => i.state === 'local');
    if (!local.length) return this.ready;
    await Promise.all(local.map(i => this.upload(i)));
    if (this.root && selected.some(i => i.state === 'checking')) {
      await new Promise<void>(resolve => {
        this.settle = () => {
          if (
            this.root &&
            selected.every(i => this.items.includes(i)) &&
            selected.some(i => i.state === 'checking')
          )
            return;
          this.settle = undefined;
          resolve();
        };
        this.settle();
      });
    }
    return (
      !!this.root &&
      this.items.length === selected.length &&
      selected.every(i => this.items.includes(i) && i.state === 'ready')
    );
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
      if (signal.aborted || !this.compose) return;
      this.policy = { enabled: false, maxCount: 0, maxBytes: 0 };
    }
    if ((!this.policy.enabled && !this.compose) || signal.aborted) return;
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'attachment-plus button button-empty';
    plus.append(this.pickerIcon?.('plus') ?? '+');
    plus.setAttribute('aria-label', i18n.site.attachMedia);
    plus.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div');
    menu.className = 'attachment-menu';
    menu.hidden = true;
    plus.setAttribute('aria-haspopup', 'menu');
    menu.setAttribute('role', 'menu');
    const close = () => {
      menu.hidden = true;
      plus.setAttribute('aria-expanded', 'false');
      plus.focus();
    };
    plus.onclick = () => {
      menu.hidden = !menu.hidden;
      plus.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    };
    menu.onkeydown = e => {
      const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const pos = buttons.indexOf(document.activeElement as HTMLButtonElement);
      switch (e.key) {
        case 'Escape':
          close();
          break;
        case 'ArrowDown':
          buttons[(pos + 1) % buttons.length]?.focus();
          break;
        case 'ArrowUp':
          buttons[(pos + buttons.length - 1) % buttons.length]?.focus();
          break;
        case 'Home':
          buttons[0]?.focus();
          break;
        case 'End':
          buttons[buttons.length - 1]?.focus();
          break;
        case 'Tab':
          close();
          return;
        default:
          return;
      }
      e.preventDefault();
      e.stopPropagation();
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
      button.className = this.surface === 'msg' ? 'msg-picker-row' : 'button button-empty';
      if (this.surface === 'msg') button.setAttribute('role', 'menuitem');
      button.disabled = !this.policy?.enabled;
      if (this.pickerIcon)
        button.append(this.pickerIcon(accept.startsWith('image/') ? 'photo' : 'file'), ' ');
      button.append(label);
      button.onclick = () => {
        input.click();
        close();
      };
      input.onchange = () => {
        this.add(Array.from(input.files ?? []));
        input.value = '';
      };
      if (accept.startsWith('image/')) this.pickPhotos = () => input.click();
      menu.append(button, input);
    };
    pick(
      this.surface === 'msg' ? i18n.inbox.photosAndVideos : i18n.site.mediaPhotos,
      this.surface === 'msg' ? 'image/*,video/*' : 'image/png,image/jpeg,image/webp',
    );
    pick(
      this.surface === 'msg' ? i18n.inbox.file : i18n.site.mediaFiles,
      this.surface === 'msg' ? '' : accepted,
    );
    if (this.compose)
      for (const type of ['poll', 'contact'] as const) {
        const entry = document.createElement('button');
        entry.type = 'button';
        entry.className = 'msg-picker-row';
        entry.setAttribute('role', 'menuitem');
        if (this.pickerIcon) entry.append(this.pickerIcon(type));
        entry.append(i18n.inbox[type]);
        entry.onclick = () => {
          close();
          this.compose?.(type);
        };
        menu.append(entry);
      }
    if (this.surface === 'forum' && window.matchMedia('(pointer: coarse)').matches)
      pick(i18n.site.mediaCamera, 'image/*', true);
    const list = document.createElement('div');
    list.className = 'attachment-items';
    list.setAttribute('aria-live', 'polite');
    root.replaceChildren(plus, menu, list);
    document.addEventListener(
      'pointerdown',
      e => {
        if (!menu.hidden && !menu.contains(e.target as Node) && !plus.contains(e.target as Node)) close();
      },
      { signal },
    );
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

  stagePreview(file: File): void {
    if (!this.active) this.add([file]);
  }
  discardPreview(file: File): void {
    const item = this.items.find(i => i.file === file);
    if (!item) return;
    ++item.generation;
    if (item.id) void this.action(item.id, 'remove');
    if (item.preview) URL.revokeObjectURL(item.preview);
    this.items.splice(this.items.indexOf(item), 1);
    this.render();
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
        (this.surface === 'msg' || /\.(?:jpe?g|png|webp|txt|pgn)$/i.test(file.name));
      const item: Item = { file, generation: 0, state: valid ? 'uploading' : 'blocked' };
      if (
        valid &&
        (/^image\/(jpeg|png|webp|avif|bmp)$/.test(file.type) ||
          /\.(jpe?g|webp|png|avif|bmp)$/i.test(file.name))
      )
        item.preview = URL.createObjectURL(file);
      this.items.push(item);
      if (valid && this.surface === 'msg' && this.editPhoto) item.state = 'local';
      else if (valid) void this.upload(item);
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
    this.settle?.();
    const list = this.root?.querySelector('.attachment-items');
    if (!list) return;
    const focus = list.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.action
      : undefined;
    list.replaceChildren();
    this.items.forEach((i, index) => {
      const row = document.createElement('div');
      row.className = 'attachment-item';
      const tile = !!i.preview && this.surface === 'msg';
      if (tile) row.classList.add('photo-tile');
      if (i.preview) {
        const img = document.createElement('img');
        img.alt = tile ? i.file.name : '';
        img.src = i.preview;
        row.append(img);
      }
      const title = document.createElement('span');
      title.textContent = i.file.name + ' · ' + Math.ceil((i.size ?? i.file.size) / 1024) + ' KiB';
      const state = document.createElement('small');
      state.textContent = {
        local: '',
        uploading: i18n.site.mediaUploading,
        checking: i18n.site.mediaChecking,
        ready: i18n.site.mediaReady,
        blocked: i18n.site.mediaBlocked,
        retry: i18n.site.mediaRetry,
      }[i.state];
      if (tile) {
        if (i.state === 'blocked' || i.state === 'retry') row.append(state);
        if (i.state === 'checking' || i.state === 'uploading') row.setAttribute('aria-busy', 'true');
      } else {
        title.append(state);
        row.append(title);
      }
      const button = (name: string, action: string, run: () => void) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'button button-empty';
        el.setAttribute('aria-label', name);
        el.title = name;
        if (tile && action === 'edit') el.className = 'tile-edit';
        else if (tile && action === 'remove') {
          el.className = 'tile-remove';
          el.textContent = '×';
        } else el.textContent = name;
        el.dataset.action = action + index;
        el.onclick = run;
        row.append(el);
      };
      if (this.editPhoto && i.preview && !i.retained)
        button(i18n.inbox.photoEdit, 'edit', () => void this.edit(i));
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
    if (this.surface === 'msg' && this.items.length && this.items.length < (this.policy?.maxCount ?? 0)) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'tile-add';
      more.setAttribute('aria-label', i18n.site.mediaPhotos);
      more.append(this.pickerIcon?.('plus') ?? '+');
      more.onclick = () => this.pickPhotos?.();
      list.append(more);
    }
    if (this.warning) list.append(document.createTextNode(this.warning));
    if (focus) list.querySelector<HTMLElement>('[data-action="' + focus + '"]')?.focus();
    this.redraw?.();
  }
  private async edit(item: Item) {
    const signal = this.abort?.signal;
    if (!signal || signal.aborted || this.editing) return;
    this.editing = item;
    this.render();
    try {
      const file = await this.editPhoto?.(item.file, signal);
      const index = this.items.indexOf(item);
      if (!file || index < 0 || signal.aborted) return;
      if (file === item.file) return;
      ++item.generation;
      if (item.id) void this.action(item.id, 'remove');
      if (item.preview) URL.revokeObjectURL(item.preview);
      const replacement: Item = { file, generation: 0, preview: URL.createObjectURL(file), state: 'blocked' };
      this.items[index] = replacement;
      if (this.policy && file.size <= this.policy.maxBytes) replacement.state = 'local';
    } catch {
      if (!signal.aborted) this.warning = i18n.site.mediaRetry;
    } finally {
      this.editing = undefined;
      this.render();
    }
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
    this.settle?.();
    this.redraw = undefined;
  }
}

export function showForumMedia(root: HTMLElement, id: string): void {
  if (!/^[a-f0-9]{32}$/.test(id)) return;
  const url = '/attachment/forum/item/' + id;
  void json<{ name: string; mime: string; size: number }>(url + '?meta=1')
    .then(meta => {
      if (!root.isConnected) return;
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
