import { form, json } from 'lib/xhr';

import type MsgCtrl from './ctrl';
import type { LinkPreview } from './interfaces';
import { messageLinks } from './links';

export class PreviewDraft {
  value?: { meta: LinkPreview; file?: File; image?: string };
  private url?: string;
  private abort?: AbortController;
  private timer?: Timeout;

  constructor(private readonly ctrl: MsgCtrl) {}
  reset() {
    this.abort?.abort();
    clearTimeout(this.timer);
    const old = this.value;
    this.value = undefined;
    this.url = undefined;
    if (old?.image) URL.revokeObjectURL(old.image);
    if (old?.file) this.ctrl.attachments?.discardPreview(old.file);
  }
  dismiss() {
    const url = this.url;
    this.reset();
    this.url = url;
    this.ctrl.redraw();
  }
  forSend(text: string) {
    if (this.ctrl.editing || !this.value || !messageLinks(text).some(m => m.raw === this.value!.meta.url))
      return;
    if (this.ctrl.attachments?.items.some(i => i.file !== this.value?.file)) return;
    return this.value;
  }
  update(text: string) {
    const dest = this.ctrl.data.convo?.user.id;
    const url =
      dest && !this.ctrl.editing
        ? messageLinks(text).find(m => m.raw.startsWith('https://'))?.raw
        : undefined;
    if (url === this.url) return;
    this.reset();
    this.url = url;
    if (!url || !dest || this.ctrl.attachments?.active) return;
    const { signal } = (this.abort = new AbortController());
    this.timer = setTimeout(async () => {
      try {
        const data = await json<LinkPreview & { image?: { mime: string; data: string } }>(
          '/attachment/msg/' + encodeURIComponent(dest) + '/link-preview',
          {
            method: 'POST',
            body: form({ url }),
            signal,
          },
        );
        if (signal.aborted || data.url !== url || this.ctrl.data.convo?.user.id !== dest) return;
        let file: File | undefined;
        if (data.image) {
          const bytes = Uint8Array.from(atob(data.image.data), c => c.charCodeAt(0));
          file = new File([bytes], 'preview.' + data.image.mime.split('/')[1], { type: data.image.mime });
        }
        this.value = {
          meta: { url, title: data.title, description: data.description, date: data.date },
          file,
          image: file && URL.createObjectURL(file),
        };
        this.ctrl.redraw();
      } catch {
        /* A failed preview leaves the URL sendable. */
      }
    }, 350);
  }
}
