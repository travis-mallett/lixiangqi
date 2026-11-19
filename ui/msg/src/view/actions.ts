import { h, type VNode } from 'snabbdom';

import { globalChatId } from 'lib/inboxUrl';
import { confirm } from 'lib/view';

import type MsgCtrl from '../ctrl';
import type { Convo } from '../interfaces';
import { glyph } from './icons';
import { iconButton } from './messageActions';
import { menu, row } from './sidebar';

export default function renderActions(ctrl: MsgCtrl, c: Convo): VNode[] {
  const t = i18n.inbox,
    box = ctrl.mailbox,
    id = c.user.id,
    state = box.state(id);
  const mode = (m: typeof box.mode) => {
    box.openPanel(m);
  };
  const change = async (action: string, v: boolean, close = false) => {
    if ((await box.change(id, action, String(v))) && close) {
      ctrl.data.convo = undefined;
      ctrl.showSide();
      history.replaceState({}, '', '/inbox');
    }
  };
  const ask = (label: string, run: () => void) => void confirm(label + '?').then(ok => ok && run());
  const archived =
    (state.archive ?? 0) >= Number(ctrl.data.contacts.find(x => x.user.id === id)?.lastMsg.date ?? Infinity);
  return [
    iconButton('search', t.searchChat, () => mode('search')),
    menu(t.moreActions, [
      row(state.mute ? t.unmute : t.mute, 'mute', () => void change('mute', !state.mute)),
      ...(c.user.group ? [row(t.groupSettings, 'settings', () => mode('settings'))] : []),
      row(t.allMedia, 'photo', () => mode('media')),
      row(t.selectMessages, 'select', () => {
        box.selecting = true;
        ctrl.redraw();
      }),
      ...(id === globalChatId
        ? []
        : [
            row(t.markUnread, 'message', () => void change('unread', true, true)),
            row(
              state.pin ? t.unpinChat : t.pinChat,
              state.pin ? 'unpin' : 'pin',
              () => void change('pin', !state.pin),
            ),
            row(
              archived ? t.unarchive : t.archive,
              archived ? 'unarchive' : 'archive',
              () => void change('archive', !archived, true),
            ),
            ...(c.user.group
              ? [
                  row(i18n.site.block, 'block', () => ask(i18n.site.block, () => void box.manage('block'))),
                  row(t.deleteChat, 'delete', () => ask(t.deleteChat, () => void box.manage('delete'))),
                  row(t.leaveGroup, 'group', () => ask(t.leaveGroup, () => void box.manage('leave'))),
                ]
              : id === 'lichess'
                ? []
                : [
                    h(
                      'a.msg-menu-row',
                      { attrs: { href: '/?user=' + encodeURIComponent(c.user.name) + '#friend' } },
                      [glyph('group'), i18n.challenge.challengeToPlay],
                    ),
                    row(c.relations.out === false ? i18n.site.unblock : i18n.site.block, 'block', () =>
                      c.relations.out === false ? void ctrl.unblock() : ask(i18n.site.block, ctrl.block),
                    ),
                    h(
                      'a.msg-menu-row',
                      { attrs: { href: '/report/inbox/' + encodeURIComponent(c.user.name) } },
                      [glyph('report'), t.report],
                    ),
                    row(t.deleteChat, 'delete', () => ask(t.deleteChat, ctrl.delete)),
                  ]),
          ]),
    ]),
  ];
}
