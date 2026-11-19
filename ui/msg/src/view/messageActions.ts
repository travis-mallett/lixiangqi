import { h, type VNode } from 'snabbdom';

import { domDialog, type Dialog } from 'lib/view/dialog';

import type MsgCtrl from '../ctrl';
import type { Msg } from '../interfaces';
import { report } from '../network';
import * as network from '../network';
import { downloadAttachments } from './attachments';
import { glyph, glyphElement, type Glyph } from './icons';
import { playerElement } from './identity';

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
  if (icon) el.append(glyphElement(icon));
  el.append(element('span', label));
  el.addEventListener('click', action);
  return el;
}
export async function dialog(
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
      if (!anchor) {
        if (cls === 'msg-action-dialog')
          d.dialog.addEventListener('pointerdown', e => {
            if ([...content.children].some(panel => panel.contains(e.target as Node))) return;
            e.stopPropagation();
            d.close('cancel');
          });
        return;
      }
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
  if (msg.pending === 'failed')
    return h('div.msg-toolbar', [iconButton('more', i18n.inbox.moreActions, () => showMenu(ctrl, msg))]);
  return h('div.msg-toolbar', [
    msg.deleted ? undefined : iconButton('reply', i18n.inbox.reply, () => ctrl.compose(msg)),
    !msg.deleted && msg.attachments?.length
      ? iconButton('download', i18n.site.mediaDownload, () => downloadAttachments(msg.id))
      : undefined,
    msg.deleted ? undefined : iconButton('react', i18n.inbox.react, () => showMenu(ctrl, msg, true)),
    iconButton('more', i18n.inbox.moreActions, () => showMenu(ctrl, msg)),
  ]);
}

export async function showMenu(ctrl: MsgCtrl, msg: Msg, reactionsOnly = false) {
  if (msg.pending === 'sending') return;
  const desktop = window.matchMedia('(hover: hover) and (min-width: 600px)').matches;
  const anchor = desktop
    ? document.querySelector(`[data-message-id="${CSS.escape(msg.id)}"] .msg-bubble`)?.getBoundingClientRect()
    : undefined;
  const content = element('div', undefined, 'msg-context');
  const perform = (run: () => unknown) => () => {
    dlg.close();
    run();
  };
  if (msg.pending === 'failed') {
    const menu = element('div', undefined, 'msg-context-menu');
    menu.append(
      button(
        i18n.inbox.retry,
        perform(() => ctrl.retry(msg)),
      ),
      button(
        i18n.inbox.deleteMe,
        perform(() => ctrl.discardFailed(msg)),
        'delete',
      ),
    );
    content.append(menu);
  }
  if (!msg.pending && !msg.deleted && (!desktop || reactionsOnly)) {
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
      '',
      perform(() => showEmoji(i18n.inbox.reactions, emoji => react(ctrl, msg, emoji))),
      'more',
    );
    more.className = 'msg-reaction-option';
    more.setAttribute('aria-label', i18n.inbox.moreReactions);
    strip.append(more);
    content.append(strip);
  }
  if (!msg.pending && !reactionsOnly) {
    if (!desktop)
      content.append(
        element(
          'div',
          msg.deleted
            ? i18n.inbox.deleted
            : msg.text || i18n.site.mediaFiles + ' · ' + (msg.attachments?.length ?? 0),
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
          'report',
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
      if (msg.attachments?.length)
        menu.append(
          button(
            i18n.site.mediaDownload,
            perform(() => downloadAttachments(msg.id)),
            'download',
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
      if (!msg.card?.poll)
        menu.append(
          button(
            i18n.inbox.forward,
            perform(() => showForward(ctrl, [msg])),
            'forward',
          ),
        );
      if (msg.text)
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
    if (!msg.deleted && (!ctrl.global || ctrl.data.convo?.canModerate))
      menu.append(
        button(
          msg.pinnedAt ? i18n.inbox.unpin : i18n.inbox.pin,
          perform(() => ctrl.act(msg, 'pin', String(!msg.pinnedAt))),
          msg.pinnedAt ? 'unpin' : 'pin',
        ),
      );
    if (
      !ctrl.global ||
      (!msg.deleted &&
        (ctrl.data.convo?.canModerate ||
          (msg.user === ctrl.data.me.id && msg.canDeleteUntil && msg.canDeleteUntil > new Date())))
    )
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
export async function showEmoji(title: string, choose: (emoji: string) => void) {
  const content = element('div');
  content.append(element('h2', title));
  const input = element('input');
  input.type = 'search';
  input.placeholder = i18n.inbox.searchEmoji;
  input.setAttribute('aria-label', i18n.inbox.searchEmoji);
  const grid = element('div', undefined, 'msg-emoji-grid');
  content.append(input, grid);
  const dlg = await dialog(content, 'msg-emoji-dialog', title);
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
            choose(emoji);
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
  content.append(
    element('div', msg.deleted ? i18n.inbox.deleted : msg.text || i18n.site.mediaFiles, 'msg-detail-bubble'),
  );
  const list = element('dl');
  for (const [label, value] of [
    [i18n.inbox.from, msg.user],
    [
      i18n.inbox.to,
      ctrl.data.convo?.user.group || msg.user === ctrl.data.me.id
        ? ctrl.data.convo?.user.name
        : ctrl.data.me.name,
    ],
    [i18n.inbox.sentAt, msg.date.toLocaleString()],
    [i18n.inbox.deliveredAt, msg.deliveredAt?.toLocaleString()],
    [i18n.inbox.readAt, msg.readAt?.toLocaleString()],
  ]) {
    if (ctrl.global && (label === i18n.inbox.deliveredAt || label === i18n.inbox.readAt)) continue;
    const dd = element('dd');
    if (value && (label === i18n.inbox.from || (label === i18n.inbox.to && !ctrl.data.convo?.user.group)))
      dd.append(playerElement(value));
    else dd.textContent = value || i18n.inbox.unknown;
    list.append(element('dt', label), dd);
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

function canDeleteEveryone(ctrl: MsgCtrl, messages: Msg[]) {
  return (
    messages.length > 0 &&
    messages.every(
      m =>
        !m.deleted &&
        ((ctrl.global && ctrl.data.convo?.canModerate) ||
          ((m.user === ctrl.data.me.id || ctrl.data.convo?.admins?.includes(ctrl.data.me.id)) &&
            m.canDeleteUntil &&
            m.canDeleteUntil > new Date())),
    )
  );
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
  if (!ctrl.global) content.append(button(i18n.inbox.deleteMe, () => remove('deleteMe'), 'delete'));
  if (canDeleteEveryone(ctrl, messages)) {
    if (!ctrl.data.convo?.canModerate) content.append(element('p', i18n.inbox.deleteEveryoneHelp));
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
      ...users.map(u => {
        const choice = button(u.name, async () => {
          input.disabled = true;
          if (await ctrl.forward(messages, u.id)) dlg.close();
          else {
            input.disabled = false;
            results.append(element('p', i18n.inbox.error));
          }
        });
        choice.replaceChildren(playerElement(u));
        return choice;
      }),
    );
  if (ctrl.compact)
    void network
      .loadContacts()
      .then(data => {
        if (!input.value) render(data.contacts.map(c => c.user));
      })
      .catch(() => {});
  else render(ctrl.data.contacts.map(c => c.user));
  let timer: Timeout;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const query = input.value;
    timer = setTimeout(async () => {
      try {
        const res = await network.search(query);
        if (input.value !== query) return;
        const users = [...res.contacts.map(c => c.user), ...res.friends, ...res.users];
        render([...new Map(users.map(u => [u.id, u])).values()]);
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
  if (!ctrl.mailbox.selecting && !ctrl.selected.size) return;
  const messages = (ctrl.data.convo?.msgs ?? []).filter(m => ctrl.selected.has(m.id)).reverse();
  return h('div.msg-selection-bar', [
    iconButton('close', i18n.inbox.cancel, () => {
      ctrl.mailbox.selecting = false;
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
    messages.every(m => !m.deleted && !m.card?.poll)
      ? iconButton('forward', i18n.inbox.forward, () => showForward(ctrl, messages))
      : undefined,
    iconButton('delete', i18n.inbox.delete, () => showDelete(ctrl, messages)),
  ]);
}
