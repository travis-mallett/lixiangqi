import { h, type VNode } from 'snabbdom';

import { json } from 'lib/xhr';

import type { Msg } from '../interfaces';
import { glyphElement, type Glyph } from './icons';
import { avatarColor, loadAvatar, playerElement } from './identity';

interface Media {
  url: string;
  name: string;
  size: number;
  mime: string;
}

function link(item: Media) {
  const el = document.createElement('a');
  el.href = item.url + '?download=1';
  el.download = item.mime === 'image/webp' ? item.name.replace(/(?:\.[^.]+)?$/, '.webp') : item.name;
  if (item.mime === 'video/mp4') el.download = item.name.replace(/(?:\.[^.]+)?$/, '.mp4');
  el.textContent = item.name;
  return el;
}

function button(label: string, run: () => void, icon?: Glyph) {
  const el = document.createElement('button');
  el.type = 'button';
  el.title = label;
  el.setAttribute('aria-label', label);
  el.append(icon ? glyphElement(icon) : label);
  el.onclick = run;
  return el;
}

function modal(root: HTMLElement, label: string) {
  const dialog = document.createElement('dialog');
  dialog.className = 'msg-media-dialog';
  dialog.setAttribute('aria-label', label);
  dialog.onclose = () => dialog.remove();
  dialog.onclick = e => {
    if (e.target === dialog) dialog.close();
  };
  root.append(dialog);
  return dialog;
}

// Adapted from Signal Desktop Lightbox (AGPL-3.0-only, Signal Messenger LLC).
interface MediaContext {
  msg: Msg;
  sender: string;
  forward?(): void;
}
const albums = new WeakMap<HTMLElement, { length: number; open(index: number): void }>();

function gallery(root: HTMLElement, photos: Media[], index: number, context: MediaContext) {
  const { msg, sender: name } = context;
  // Timeline and media-search rows are in reading order. Each album owns its sender and controls.
  const neighbors = Array.from(
    root.closest('.msg-app__convo__msgs')?.querySelectorAll<HTMLElement>('.msg-media') ?? [],
  ).filter(node => albums.has(node));
  const position = neighbors.indexOf(root);
  const previousAlbum = albums.get(neighbors[position - 1]);
  const nextAlbum = albums.get(neighbors[position + 1]);

  const dialog = modal(root, i18n.site.mediaPhotos);
  dialog.className = 'msg-lightbox';
  const header = document.createElement('header');
  const avatar = document.createElement('span');
  avatar.className = 'msg-avatar ' + avatarColor(msg.user);
  avatar.textContent = [...name][0]?.toLocaleUpperCase() ?? '';
  loadAvatar(avatar, msg.user);
  const identity = document.createElement('div');
  const sender = document.createElement('strong');
  sender.append(playerElement(msg.user));
  const date = document.createElement('time');
  date.dateTime = msg.date.toISOString();
  date.textContent = msg.date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  identity.append(sender, date);
  const actions = document.createElement('nav');
  const forward = button(
    i18n.inbox.forward,
    () => {
      dialog.close();
      context.forward?.();
    },
    'forward',
  );
  const close = button(i18n.inbox.close, () => dialog.close(), 'close');
  close.autofocus = true;
  header.append(avatar, identity, actions);
  const stage = document.createElement('div');
  stage.className = 'msg-lightbox-stage';
  const img = document.createElement('img');
  const zoom = button(i18n.site.mediaPhotos, () => {
    const active = dialog.classList.toggle('zoom');
    zoom.setAttribute('aria-pressed', String(active));
    img.style.transformOrigin = 'center';
  });
  zoom.className = 'msg-lightbox-zoom';
  zoom.replaceChildren(img);
  zoom.onpointermove = e => {
    if (!dialog.classList.contains('zoom')) return;
    const rect = stage.getBoundingClientRect();
    img.style.transformOrigin =
      ((e.clientX - rect.left) / rect.width) * 100 +
      '% ' +
      ((e.clientY - rect.top) / rect.height) * 100 +
      '%';
  };
  const video = document.createElement('video');
  video.controls = true;
  video.playsInline = true;
  const prev = button(i18n.site.previous, () => select(index - 1), 'prev');
  const next = button(i18n.site.next, () => select(index + 1), 'next');
  prev.className = 'prev';
  next.className = 'next';
  stage.append(zoom, video, prev, next);
  const footer = document.createElement('footer');
  const strip = document.createElement('div');
  strip.className = 'msg-lightbox-thumbs';
  if (photos.length > 1)
    for (const [i, item] of photos.entries()) {
      const tile = button(item.name, () => select(i));
      tile.replaceChildren(thumbnail(item));
      strip.append(tile);
    }
  if (msg.text) {
    const caption = document.createElement('p');
    caption.textContent = msg.text;
    footer.append(caption);
  }
  footer.append(strip);
  function select(i: number) {
    if (i < 0 || i >= photos.length) {
      const album = i < 0 ? previousAlbum : nextAlbum;
      if (album) {
        dialog.close();
        album.open(i < 0 ? album.length - 1 : 0);
      }
      return;
    }
    index = i;
    dialog.classList.remove('zoom');
    zoom.setAttribute('aria-pressed', 'false');
    const item = photos[i];
    const clip = item.mime === 'video/mp4';
    video.pause();
    video.hidden = !clip;
    zoom.hidden = clip;
    if (clip) {
      video.src = item.url;
      video.setAttribute('aria-label', item.name);
      void video.play().catch(() => {});
    } else {
      video.removeAttribute('src');
      video.load();
      img.src = item.url;
      img.alt = item.name;
    }
    prev.hidden = i === 0 && !previousAlbum;
    next.hidden = i === photos.length - 1 && !nextAlbum;
    Array.from(strip.children).forEach((el, idx) => el.setAttribute('aria-current', String(idx === i)));
    const selected = strip.children[i] as HTMLElement | undefined;
    if (selected) strip.scrollLeft = selected.offsetLeft - (strip.clientWidth - selected.offsetWidth) / 2;
    const download = link(photos[i]);
    download.title = i18n.site.mediaDownload;
    download.setAttribute('aria-label', download.title);
    download.replaceChildren(glyphElement('download'));
    actions.replaceChildren(...(context.forward ? [forward] : []), download, close);
  }
  dialog.onkeydown = e => {
    if (
      !dialog.classList.contains('zoom') &&
      e.target !== video &&
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
    ) {
      e.preventDefault();
      select(index + ((e.key === 'ArrowLeft') !== (document.documentElement.dir === 'rtl') ? -1 : 1));
    }
  };
  dialog.append(header, stage, footer);
  select(index);
  dialog.showModal();
}

function thumbnail(item: Media) {
  if (item.mime === 'video/mp4') {
    const video = document.createElement('video');
    video.src = item.url;
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('aria-hidden', 'true');
    return video;
  }
  const img = document.createElement('img');
  img.src = item.url;
  img.alt = item.name;
  img.loading = 'lazy';
  return img;
}

const isVisual = (item: Media) => item.mime === 'image/webp' || item.mime === 'video/mp4';

const downloads = new WeakMap<Element, () => void>();
export function downloadAttachments(messageId: string) {
  const root = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"] .msg-media`);
  if (root) downloads.get(root)?.();
}

function paint(root: HTMLElement, items: Media[], context: MediaContext) {
  const { msg } = context;
  const photos = items.filter(isVisual);
  if (msg.card?.preview) {
    const photo = photos.find(item => item.mime === 'image/webp');
    if (photo) {
      const image = document.createElement('img');
      image.alt = '';
      // Signal Desktop shouldUseFullSizeLinkPreviewImage (AGPL-3.0-only).
      image.onload = () => {
        if (!root.contains(image)) return;
        const { naturalWidth: width, naturalHeight: height } = image;
        if (width >= 200 && height >= 200 && Math.abs(1 - width / height) >= 0.05) {
          image.classList.add('msg-link-card__banner');
          root
            .closest<HTMLElement>('.msg-bubble')
            ?.style.setProperty('--msg-preview-width', Math.min(width, 300) + 'px');
        }
      };
      image.src = photo.url;
      root.append(image);
    }
    return;
  }
  if (photos.length) {
    const open = (i: number) => gallery(root, photos, i, context);
    albums.set(root, { length: photos.length, open });
    const grid = document.createElement('div');
    grid.className = 'msg-album album-' + Math.min(5, photos.length);
    photos.slice(0, 5).forEach((item, i) => {
      const tile = button(item.name, () => open(i));
      tile.replaceChildren(thumbnail(item));
      if (item.mime === 'video/mp4') tile.classList.add('msg-video-tile');
      if (i === 4 && photos.length > 5) {
        const count = document.createElement('span');
        count.textContent = '+' + (photos.length - 5);
        tile.append(count);
      }
      grid.append(tile);
    });
    root.append(grid);
  }
  for (const item of items.filter(i => !isVisual(i))) {
    const card = link(item);
    card.className = 'msg-file';
    const icon = document.createElement('span');
    icon.className = 'msg-file-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.append(glyphElement('fileFill'));
    if (item.name.includes('.')) {
      const extension = document.createElement('small');
      extension.textContent = item.name.split('.').pop()!.slice(0, 5);
      icon.append(extension);
    }
    const size = document.createElement('small');
    size.textContent = formatFileSize(item.size);
    const name = document.createElement('strong');
    name.textContent = item.name;
    card.replaceChildren(icon, name, size);
    root.append(card);
  }
}

function showDownloads(root: HTMLElement, items: Media[]) {
  if (items.length === 1) {
    link(items[0]).click();
    return;
  }
  const dialog = modal(root, i18n.site.mediaDownload);
  dialog.append(
    ...(items.length ? items.map(link) : [i18n.site.mediaRetry]),
    button(i18n.inbox.close, () => dialog.close()),
  );
  dialog.showModal();
}

function formatFileSize(bytes: number) {
  const unit = bytes >= 1048576 ? 'megabyte' : bytes >= 1024 ? 'kilobyte' : 'byte';
  const divisor = unit === 'megabyte' ? 1048576 : unit === 'kilobyte' ? 1024 : 1;
  return new Intl.NumberFormat(document.documentElement.lang || undefined, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(bytes / divisor);
}

// Adapted from Signal Desktop Message.renderPreview and _modules.scss (AGPL-3.0-only).
export function messageLinkPreview(context: MediaContext, selecting: boolean): VNode {
  const { msg } = context;
  const preview = msg.card!.preview!;
  return h(
    'a.msg-link-card',
    {
      attrs: { href: preview.url, target: '_blank', rel: 'noreferrer noopener', inert: selecting },
    },
    [
      !msg.pending && msg.attachments?.length ? messageAttachments(context, selecting) : undefined,
      h('div.msg-link-card__text', [
        h('strong', preview.title),
        preview.description && h('div.msg-link-card__description', preview.description),
        h('div.msg-link-card__footer', [
          h('span', new URL(preview.url).hostname),
          preview.date ? h('span', ' • ' + new Date(preview.date).toLocaleDateString()) : undefined,
        ]),
      ]),
    ],
  );
}

export function messageAttachments(context: MediaContext, selecting: boolean): VNode {
  const { msg } = context;
  const ids = msg.attachments!;
  return h('div.msg-media', {
    key: msg.id + ':' + msg.text + ':' + ids.join(','),
    attrs: { inert: selecting },
    hook: {
      insert: vnode => {
        const root = vnode.elm as HTMLElement;
        let request: AbortController;
        const clear = () => {
          request?.abort();
          root.querySelector('dialog')?.close();
          root.replaceChildren();
          if (msg.card?.preview)
            root.closest<HTMLElement>('.msg-bubble')?.style.removeProperty('--msg-preview-width');
          downloads.delete(root);
          albums.delete(root);
        };
        const refresh = async () => {
          clear();
          if (document.hidden) return;
          const { signal } = (request = new AbortController());
          const pending = Promise.all(
            ids.map(async id => {
              if (!/^[a-f0-9]{32}$/.test(id)) return;
              const url = '/attachment/msg/item/' + id;
              try {
                return { ...(await json<Omit<Media, 'url'>>(url + '?meta=1', { signal })), url };
              } catch {
                return undefined;
              }
            }),
          );
          const available = pending.then(items => items.filter((i): i is Media => !!i));
          downloads.set(root, async () => {
            const items = await available;
            if (!signal.aborted && root.isConnected) showDownloads(root, items);
          });
          const items = await available;
          if (!signal.aborted && root.isConnected) paint(root, items, context);
        };
        document.addEventListener('visibilitychange', refresh);
        window.addEventListener('pageshow', refresh);
        const dispose = () => {
          clear();
          document.removeEventListener('visibilitychange', refresh);
          window.removeEventListener('pageshow', refresh);
        };
        // Snabbdom patches vnode hooks on redraw. Keep cleanup with the element.
        disposers.set(root, dispose);
        void refresh();
      },
      destroy: vnode => disposers.get(vnode.elm!)?.(),
    },
  });
}
const disposers = new WeakMap<Node, () => void>();
