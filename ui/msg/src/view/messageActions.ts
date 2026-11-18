import { h, type VNode } from 'snabbdom';

import { domDialog, type Dialog } from 'lib/view/dialog';

import type MsgCtrl from '../ctrl';
import type { Msg } from '../interfaces';
import { report } from '../network';
import * as network from '../network';

// Original, shared 24px outline geometry. No Signal artwork is embedded.
const paths = {
  react: ['M12 20 4 12C-2 5 7 0 12 6 17 0 26 5 20 11', 'M18 14v8m-4-4h8'],
  reply: ['m10 5-7 7 7 7v-5h3c4 0 6 2 8 5 0-9-4-11-11-11Z'],
  forward: ['m14 5 7 7-7 7v-5h-3c-4 0-6 2-8 5 0-9 4-11 11-11Z'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
  copy: ['M8 8h13v13H8ZM16 8V3H3v13h5'],
  select: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'm7 12 3 3 7-7'],
  info: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M12 11v6m0-10h.01'],
  pin: ['m16 3 5 5-4 1-3 4 1 4-2 2-8-8 2-2 4 1 4-3ZM8 16l-5 5'],
  delete: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7'],
  edit: ['m15 4 5 5M4 16 16 4a3 3 0 0 1 4 4L8 20l-5 1Z'],
  close: ['m6 6 12 12M6 18 18 6'],
  check: ['m5 12 4 4L19 6'],
  read: ['m2 12 4 4L16 6m-5 10 3 3L24 9'],
  send: ['m3 3 19 9-19 9 4-9ZM7 12h15'],
  clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M12 7v5l3 2'],
} as const;
type Glyph = keyof typeof paths;
export const glyph = (name: Glyph): VNode =>
  h(
    'svg.msg-glyph',
    {
      attrs: {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': name === 'more' ? 3.5 : 1.7,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
      },
    },
    paths[name].map(d => h('path', { attrs: { d } })),
  );

export const iconButton = (name: Glyph, label: string, action: () => unknown): VNode =>
  h(
    'button.msg-icon-button',
    {
      attrs: { type: 'button', title: label, 'aria-label': label },
      on: {
        click: e => {
          e.stopPropagation();
          action();
        },
      },
    },
    [glyph(name)],
  );

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function button(label: string, action: () => unknown, icon?: Glyph) {
  const el = element('button', undefined, 'msg-menu-item');
  el.type = 'button';
  if (icon) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'msg-glyph');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of paths[icon]) {
      const p = document.createElementNS(svg.namespaceURI, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    el.append(svg);
  }
  el.append(element('span', label));
  el.addEventListener('click', action);
  return el;
}
async function dialog(
  content: HTMLElement,
  cls: string,
  title: string,
  anchor?: DOMRect,
  mine = false,
): Promise<Dialog> {
  const dlg = await domDialog({
    class: cls,
    append: [{ node: content }],
    modal: true,
    noCloseButton: cls === 'msg-action-dialog',
    easyClose: 'clickOutside',
    attrs: { dialog: { 'aria-label': title } },
    onShow: d => {
      if (!anchor) return;
      d.dialog.classList.add('msg-anchored-menu');
      const rect = d.dialog.getBoundingClientRect();
      const left = mine ? anchor.left - rect.width - 8 : anchor.right + 8;
      Object.assign(d.dialog.style, {
        margin: '0',
        transform: 'none',
        right: 'auto',
        left: `${Math.max(12, Math.min(window.innerWidth - rect.width - 12, left))}px`,
        top: `${Math.max(12, Math.min(window.innerHeight - rect.height - 12, anchor.top))}px`,
      });
    },
  });
  void dlg.show();
  return dlg;
}

export function toolbar(ctrl: MsgCtrl, msg: Msg): VNode {
  return h('div.msg-toolbar', [
    msg.deleted ? undefined : iconButton('react', i18n.inbox.react, () => showMenu(ctrl, msg, true)),
    msg.deleted ? undefined : iconButton('reply', i18n.inbox.reply, () => ctrl.compose(msg)),
    iconButton('more', i18n.inbox.moreActions, () => showMenu(ctrl, msg)),
  ]);
}

export async function showMenu(ctrl: MsgCtrl, msg: Msg, reactionsOnly = false) {
  if (msg.pending) return;
  const desktop = window.matchMedia('(hover: hover) and (min-width: 600px)').matches;
  const anchor = desktop
    ? document.querySelector(`[data-message-id="${CSS.escape(msg.id)}"] .msg-bubble`)?.getBoundingClientRect()
    : undefined;
  const content = element('div', undefined, 'msg-context');
  const perform = (run: () => unknown) => () => {
    dlg.close();
    run();
  };
  if (!msg.deleted && (!desktop || reactionsOnly)) {
    const strip = element('div', undefined, 'msg-reaction-strip');
    for (const emoji of ['❤️', '👍', '👎', '😂', '😮', '😢']) {
      const b = button(
        emoji,
        perform(() => react(ctrl, msg, emoji)),
      );
      b.className = 'msg-reaction-option';
      b.setAttribute('aria-label', `${i18n.inbox.react} ${emoji}`);
      strip.append(b);
    }
    const more = button(
      '…',
      perform(() => showEmoji(ctrl, msg)),
    );
    more.className = 'msg-reaction-option';
    more.setAttribute('aria-label', i18n.inbox.moreReactions);
    strip.append(more);
    content.append(strip);
  }
  if (!reactionsOnly) {
    if (!desktop)
      content.append(
        element(
          'div',
          msg.deleted ? i18n.inbox.deleted : msg.text,
          `msg-context-preview ${msg.user === ctrl.data.me.id ? 'mine' : 'their'}`,
        ),
      );
    const menu = element('div', undefined, 'msg-context-menu');
    if (!msg.deleted && msg.user !== ctrl.data.me.id)
      menu.append(
        button(
          i18n.site.mediaReportBlock,
          perform(async () => {
            if (!window.confirm(i18n.site.mediaReportBlock + '?')) return;
            try {
              await report(msg.user, msg);
              await ctrl.openConvo(msg.user);
            } catch {
              ctrl.error = true;
              ctrl.redraw();
            }
          }),
        ),
      );
    if (!msg.deleted) {
      menu.append(
        button(
          i18n.inbox.reply,
          perform(() => ctrl.compose(msg)),
          'reply',
        ),
      );
      if (msg.user === ctrl.data.me.id && msg.canEditUntil && msg.canEditUntil > new Date())
        menu.append(
          button(
            i18n.inbox.edit,
            perform(() => ctrl.compose(msg, true)),
            'edit',
          ),
        );
      menu.append(
        button(
          i18n.inbox.forward,
          perform(() => showForward(ctrl, [msg])),
          'forward',
        ),
      );
      menu.append(
        button(
          i18n.inbox.copy,
          perform(() => copyMessages(ctrl, [msg])),
          'copy',
        ),
      );
    }
    menu.append(
      button(
        i18n.inbox.select,
        perform(() => ctrl.toggleSelect(msg.id)),
        'select',
      ),
    );
    menu.append(
      button(
        i18n.inbox.info,
        perform(() => showDetails(ctrl, msg)),
        'info',
      ),
    );
    if (!msg.deleted)
      menu.append(
        button(
          msg.pinnedAt ? i18n.inbox.unpin : i18n.inbox.pin,
          perform(() => ctrl.act(msg, 'pin', String(!msg.pinnedAt))),
          'pin',
        ),
      );
    menu.append(
      button(
        i18n.inbox.delete,
        perform(() => showDelete(ctrl, [msg])),
        'delete',
      ),
    );
    content.append(menu);
  }
  const dlg = await dialog(
    content,
    'msg-action-dialog',
    i18n.inbox.moreActions,
    anchor,
    msg.user === ctrl.data.me.id,
  );
}

function react(ctrl: MsgCtrl, msg: Msg, emoji: string) {
  return ctrl.act(
    msg,
    'react',
    msg.reactions.some(r => r.user === ctrl.data.me.id && r.emoji === emoji) ? '' : emoji,
  );
}

let emojiData: Promise<[string, string][]> | undefined;
async function showEmoji(ctrl: MsgCtrl, msg: Msg) {
  const content = element('div');
  content.append(element('h2', i18n.inbox.reactions));
  const input = element('input');
  input.type = 'search';
  input.placeholder = i18n.inbox.searchEmoji;
  input.setAttribute('aria-label', i18n.inbox.searchEmoji);
  const grid = element('div', undefined, 'msg-emoji-grid');
  content.append(input, grid);
  const dlg = await dialog(content, 'msg-emoji-dialog', i18n.inbox.reactions);
  try {
    emojiData ??= fetch(site.asset.url('javascripts/inbox/emoji.json')).then(r => {
      if (!r.ok) throw new Error('Emoji catalogue unavailable');
      return r.json();
    });
    const emojis = await emojiData;
    let filtered = emojis,
      shown = 0;
    const more = () => {
      grid.append(
        ...filtered.slice(shown, shown + 120).map(([emoji, name]) => {
          const b = button(emoji, () => {
            dlg.close();
            void react(ctrl, msg, emoji);
          });
          b.title = name;
          b.setAttribute('aria-label', name);
          return b;
        }),
      );
      shown += 120;
    };
    const render = () => {
      const query = input.value.trim().toLowerCase();
      filtered = emojis.filter(
        ([emoji, name]) => !query || name.toLowerCase().includes(query) || emoji.includes(query),
      );
      shown = 0;
      grid.replaceChildren();
      grid.scrollTop = 0;
      more();
    };
    grid.addEventListener('scroll', () => {
      if (shown < filtered.length && grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 100) more();
    });
    input.addEventListener('input', render);
    render();
    input.focus();
  } catch {
    grid.textContent = i18n.inbox.error;
    emojiData = undefined;
  }
}

export async function showDetails(ctrl: MsgCtrl, msg: Msg, history = false) {
  const content = element('div');
  content.append(element('h2', history ? i18n.inbox.editHistory : i18n.inbox.info));
  content.append(element('div', msg.deleted ? i18n.inbox.deleted : msg.text, 'msg-detail-bubble'));
  const list = element('dl');
  for (const [label, value] of [
    [i18n.inbox.from, msg.user],
    [i18n.inbox.to, msg.user === ctrl.data.me.id ? ctrl.data.convo?.user.name : ctrl.data.me.name],
    [i18n.inbox.sentAt, msg.date.toLocaleString()],
    [i18n.inbox.deliveredAt, msg.deliveredAt?.toLocaleString()],
    [i18n.inbox.readAt, msg.readAt?.toLocaleString()],
  ]) {
    list.append(element('dt', label), element('dd', value || i18n.inbox.unknown));
  }
  if (!history) content.append(list);
  if (msg.history.length && !msg.deleted) {
    content.append(element('h3', i18n.inbox.editHistory));
    for (const version of [...msg.history].reverse()) {
      const item = element('div', undefined, 'msg-history-item');
      item.append(element('time', version.date.toLocaleString()), element('p', version.text));
      content.append(item);
    }
  }
  await dialog(content, 'msg-details-dialog', i18n.inbox.info);
}

export async function showDelete(ctrl: MsgCtrl, messages: Msg[]) {
  const content = element('div');
  content.append(element('h2', i18n.inbox.deleteConfirm));
  const remove = async (action: string) => {
    dlg.close();
    for (const msg of messages) if (!(await ctrl.act(msg, action))) break;
    ctrl.selected.clear();
    ctrl.redraw();
  };
  content.append(button(i18n.inbox.deleteMe, () => remove('deleteMe'), 'delete'));
  if (
    messages.every(
      m => m.user === ctrl.data.me.id && m.canDeleteUntil && m.canDeleteUntil > new Date() && !m.deleted,
    )
  ) {
    content.append(element('p', i18n.inbox.deleteEveryoneHelp));
    content.append(button(i18n.inbox.deleteEveryone, () => remove('deleteEveryone'), 'delete'));
  }
  content.append(button(i18n.inbox.cancel, () => dlg.close()));
  const dlg = await dialog(content, 'msg-delete-dialog', i18n.inbox.delete);
}

export async function showForward(ctrl: MsgCtrl, messages: Msg[]) {
  const content = element('div');
  content.append(element('h2', i18n.inbox.forward));
  const input = element('input');
  input.type = 'search';
  input.placeholder = i18n.inbox.searchPeople;
  input.setAttribute('aria-label', i18n.inbox.searchPeople);
  const results = element('div', undefined, 'msg-forward-results');
  content.append(input, results);
  const dlg = await dialog(content, 'msg-forward-dialog', i18n.inbox.forward);
  const render = (users: { id: string; name: string }[]) =>
    results.replaceChildren(
      ...users.map(u =>
        button(u.name, async () => {
          input.disabled = true;
          if (await ctrl.forward(messages, u.id)) dlg.close();
          else {
            input.disabled = false;
            results.append(element('p', i18n.inbox.error));
          }
        }),
      ),
    );
  render(ctrl.data.contacts.map(c => c.user));
  let timer: Timeout;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const query = input.value;
    timer = setTimeout(async () => {
      try {
        const res = await network.search(query);
        if (input.value !== query) return;
        const users = [...res.contacts.map(c => c.user), ...res.friends, ...res.users];
        render([
          ...new Map(
            users.map(u => [u.name.toLowerCase(), { id: u.name.toLowerCase(), name: u.name }]),
          ).values(),
        ]);
      } catch {
        results.textContent = i18n.inbox.error;
      }
    }, 250);
  });
}

export async function copyMessages(ctrl: MsgCtrl, messages: Msg[]) {
  try {
    await navigator.clipboard.writeText(messages.map(m => m.text).join('\n'));
  } catch {
    ctrl.error = true;
    ctrl.redraw();
  }
}

export function selectionBar(ctrl: MsgCtrl): VNode | undefined {
  if (!ctrl.selected.size) return;
  const messages = (ctrl.data.convo?.msgs ?? []).filter(m => ctrl.selected.has(m.id)).reverse();
  return h('div.msg-selection-bar', [
    iconButton('close', i18n.inbox.cancel, () => {
      ctrl.selected.clear();
      ctrl.redraw();
    }),
    h('strong', i18n.inbox.selected(String(messages.length))),
    iconButton('copy', i18n.inbox.copy, () =>
      copyMessages(
        ctrl,
        messages.filter(m => !m.deleted),
      ),
    ),
    messages.every(m => !m.deleted)
      ? iconButton('forward', i18n.inbox.forward, () => showForward(ctrl, messages))
      : undefined,
    iconButton('delete', i18n.inbox.delete, () => showDelete(ctrl, messages)),
  ]);
}
