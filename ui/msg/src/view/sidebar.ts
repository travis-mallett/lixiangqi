import { h, type VNode } from 'snabbdom';

import { globalChatId } from 'lib/inboxUrl';
import { onInsert } from 'lib/view';

import type MsgCtrl from '../ctrl';
import type { User } from '../interfaces';
import renderContact, { userIcon } from './contact';
import { glyph, type Glyph } from './icons';
import { iconButton } from './messageActions';
import { renderResults } from './search';

export function row(label: string, icon: Glyph, run: () => void) {
  return h('button.msg-menu-row', { attrs: { type: 'button' }, on: { click: run } }, [
    glyph(icon),
    h('span', label),
  ]);
}

export function menu(label: string, children: VNode[], icon: Glyph = 'more') {
  return h(
    'details.msg-dropdown',
    {
      on: {
        toggle: e => {
          const details = e.currentTarget as HTMLDetailsElement;
          if (!details.open) return;
          const abort = new AbortController();
          document.addEventListener(
            'pointerdown',
            e => {
              if (!details.contains(e.target as Node)) details.open = false;
            },
            { signal: abort.signal },
          );
          details.addEventListener('toggle', () => abort.abort(), { once: true });
        },
        keydown: (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            const el = e.currentTarget as HTMLDetailsElement;
            el.open = false;
            el.querySelector('summary')?.focus();
          }
        },
      },
    },
    [
      h('summary', { attrs: { 'aria-label': label, title: label } }, [glyph(icon)]),
      h(
        'div.msg-dropdown-list',
        {
          on: {
            click: e => {
              (e.currentTarget as HTMLElement).closest('details')!.open = false;
            },
          },
        },
        children,
      ),
    ],
  );
}

function input(value: string, placeholder: string, onInput: (q: string) => void, key: string, focus = false) {
  return h('input', {
    key,
    attrs: { type: 'search', 'aria-label': placeholder, placeholder },
    props: { value },
    on: { input: e => onInput((e.target as HTMLInputElement).value) },
    hook: focus ? onInsert<HTMLInputElement>(el => el.focus()) : undefined,
  });
}

export function sidebar(ctrl: MsgCtrl): VNode[] {
  const box = ctrl.mailbox,
    t = i18n.inbox,
    page = box.page,
    list = page === 'chats' || page === 'archive';
  const go = (p: typeof page) => void box.go(p);
  const q = box.query.toLocaleLowerCase();
  const setQuery = (v: string) => {
    box.query = v;
    ctrl.redraw();
    if (list || page === 'username' || page === 'compose') void ctrl.searchInput(v.trim());
  };
  const people = (users: User[], multi: boolean) =>
    users
      .filter(u => u.name.toLocaleLowerCase().includes(q))
      .map(u =>
        h(
          'button.msg-person',
          {
            key: u.id,
            attrs: { type: 'button', 'aria-pressed': String(multi && box.checked.has(u.id)) },
            on: { click: () => (multi ? box.toggle(u.id) : ctrl.openConvo(u.id)) },
          },
          [
            userIcon(u, 'msg-person-avatar'),
            h('span', u.name),
            multi ? glyph(box.checked.has(u.id) ? 'check' : 'plus') : undefined,
          ],
        ),
      );
  const title = {
    chats: t.chats,
    archive: t.viewArchive,
    compose: t.newChat,
    username: t.findUsername,
    group: t.newGroup,
    folder: box.editId ? t.editFolder : t.addFolder,
    members: t.addMembers,
  }[page];
  const picker = page === 'group' || page === 'folder' || page === 'members';
  const items = box.contacts
    .filter(c => box.visible(c))
    .sort(
      (a, b) =>
        Number(b.user.id === globalChatId) - Number(a.user.id === globalChatId) ||
        Number(!!box.state(b.user.id).pin) - Number(!!box.state(a.user.id).pin),
    );
  return [
    h('header.msg-list-head', [
      page !== 'chats'
        ? iconButton('prev', t.cancel, () =>
            go(page === 'username' || page === 'group' ? 'compose' : 'chats'),
          )
        : undefined,
      h('h1', title),
      page === 'chats' ? iconButton('compose', t.newChat, () => go('compose')) : undefined,
      page === 'chats'
        ? menu(t.moreActions, [
            row(t.viewArchive, 'archive', () => {
              box.folder = '';
              box.unread = false;
              go('archive');
            }),
            row(t.addFolder, 'folder', () => go('folder')),
            h('a.msg-menu-row', { attrs: { href: '/account/preferences/notification' } }, [
              glyph('bell'),
              t.notifications,
            ]),
          ])
        : undefined,
    ]),
    picker && page !== 'members'
      ? h('div.msg-name-input', [
          h('input', {
            key: page,
            attrs: {
              maxlength: 64,
              placeholder: page === 'folder' ? t.folderName : t.groupName,
              'aria-label': page === 'folder' ? t.folderName : t.groupName,
            },
            props: { value: box.name },
            on: {
              input: e => {
                box.name = (e.target as HTMLInputElement).value;
                ctrl.redraw();
              },
            },
          }),
        ])
      : h('span', { attrs: { hidden: true } }),
    h('div.msg-app__side__search', [
      glyph('search'),
      input(
        box.query,
        page === 'username' ? t.findUsername : i18n.site.search,
        setQuery,
        page,
        page !== 'chats',
      ),
      list
        ? h(
            'button',
            {
              attrs: {
                type: 'button',
                'aria-label': t.filterUnread,
                title: t.filterUnread,
                'aria-pressed': box.unread,
              },
              on: {
                click: () => {
                  box.unread = !box.unread;
                  void box.loadCollection();
                  ctrl.redraw();
                },
              },
            },
            [glyph('filter')],
          )
        : undefined,
    ]),
    list && box.org.folders.length
      ? h('nav.msg-folders', [
          h(
            'button',
            {
              attrs: { 'aria-pressed': !box.folder },
              on: {
                click: () => {
                  box.folder = '';
                  void box.loadCollection();
                  ctrl.redraw();
                },
              },
            },
            t.allChats,
          ),
          ...box.org.folders.map(f =>
            h(
              'button',
              {
                key: f.id,
                attrs: { 'aria-pressed': box.folder === f.id },
                on: {
                  click: () => {
                    box.folder = f.id;
                    void box.loadCollection();
                    ctrl.redraw();
                  },
                },
              },
              f.name,
            ),
          ),
          box.folder
            ? iconButton(
                'edit',
                t.editFolder,
                () =>
                  void box.go(
                    'folder',
                    box.org.folders.find(f => f.id === box.folder),
                  ),
              )
            : undefined,
        ])
      : h('span', { attrs: { hidden: true } }),
    h(
      'div.msg-app__contacts.msg-app__side__content',
      {
        key: page,
        on: {
          scroll: e => {
            const el = e.currentTarget as HTMLElement;
            if ((list || page === 'folder') && el.scrollTop + el.clientHeight >= el.scrollHeight - 90) {
              if (box.scope !== 'pin') void box.loadCollection(true);
              else void ctrl.loadMoreContacts();
            }
          },
        },
      },
      [
        page === 'compose' ? row(t.newGroup, 'group', () => go('group')) : undefined,
        page === 'compose' ? row(t.findUsername, 'at', () => go('username')) : undefined,
        list && !box.query
          ? [
              ...items.map(c => renderContact(ctrl, c, ctrl.data.convo?.user.id)),
              !items.length ? h('p.msg-list-empty', t.noChats) : undefined,
              box.unread
                ? row(t.clearFilter, 'filter', () => {
                    box.unread = false;
                    void box.loadCollection();
                    ctrl.redraw();
                  })
                : undefined,
              page === 'chats' &&
              ctrl.data.contacts.some(c => (box.state(c.user.id).archive ?? 0) >= Number(c.lastMsg.date))
                ? row(t.viewArchive, 'archive', () => go('archive'))
                : undefined,
              box.hasMore ? row(t.older, 'next', () => void box.loadCollection(true)) : undefined,
            ]
          : undefined,
        (list || page === 'username' || page === 'compose') && ctrl.search.result
          ? renderResults(ctrl, ctrl.search.result)
          : undefined,
        list && box.query
          ? ctrl.data.contacts
              .filter(c => c.user.group && c.user.name.toLocaleLowerCase().includes(q))
              .map(c => renderContact(ctrl, c))
          : undefined,
        (page === 'compose' && !ctrl.search.result) || page === 'group' || page === 'members'
          ? [
              h('h2', i18n.site.friends),
              ...people(
                (box.friends ?? []).filter(
                  u => page !== 'members' || !ctrl.data.convo?.members?.some(m => m.id === u.id),
                ),
                picker,
              ),
            ]
          : undefined,
        page === 'folder'
          ? people(
              ctrl.data.contacts.map(c => c.user),
              true,
            )
          : undefined,
        ctrl.error ? h('p.msg-error', { attrs: { role: 'alert' } }, t.error) : undefined,
      ].flat(),
    ),
    picker
      ? h('footer.msg-picker-footer', [
          page === 'folder' && box.editId
            ? iconButton('delete', i18n.site.delete, () => {
                void box.change(box.editId, 'deleteFolder', '').then(ok => {
                  if (ok) {
                    box.folder = '';
                    go('chats');
                  }
                });
              })
            : undefined,
          h(
            'button.button',
            {
              attrs: {
                disabled:
                  box.busy ||
                  (page !== 'members' && !box.name.trim()) ||
                  (page !== 'folder' && !box.checked.size),
              },
              on: { click: () => void box.submit() },
            },
            t.done,
          ),
        ])
      : h('span', { attrs: { hidden: true } }),
  ];
}
