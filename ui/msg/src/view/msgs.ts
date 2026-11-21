import { h, type VNode } from 'snabbdom';

import { alert, confirm, bind } from 'lib/view';
import { json as xhrJson, form as xhrForm } from 'lib/xhr';

import { boardMessageText } from '../boardContent';
import type MsgCtrl from '../ctrl';
import type { Convo, Msg } from '../interfaces';
import { messageAttachments, messageLinkPreview } from './attachments';
import { messageBoard } from './boards';
import { renderCard } from './cards';
import { userIcon } from './contact';
import { enhance, isMoreThanText, expandLpvs } from './enhance';
import { glyph } from './icons';
import { playerName } from './identity';
import { toolbar, showMenu, showDetails, showForward } from './messageActions';
import { scroller } from './scroller';
import { messageTimeline, messageTime } from './timeline';

const presses = new WeakMap<EventTarget, { timer: Timeout; x: number; y: number }>();
function cancelPress(e: Event) {
  const target = e.currentTarget!;
  clearTimeout(presses.get(target)?.timer);
  presses.delete(target);
}

export default function renderMsgs(ctrl: MsgCtrl, convo: Convo): VNode {
  const results =
    ctrl.mailbox.mode === 'media' || (ctrl.mailbox.mode === 'search' && !!ctrl.mailbox.filter.trim());
  return h(
    'div.msg-app__convo__msgs',
    {
      on: { scroll: ctrl.setRead },
      hook: { insert: setupMsgs(true), postpatch: setupMsgs(false), destroy: scroller.destroy },
    },
    [
      h('div.msg-app__convo__msgs__init'),
      h('div.msg-app__convo__msgs__content', [
        (results ? ctrl.mailbox.next : ctrl.canGetMoreSince)
          ? h(
              'button.msg-app__convo__msgs__more.button.button-empty',
              {
                key: 'more',
                attrs: { type: 'button' },
                hook: bind('click', _ => {
                  scroller.setMarker();
                  if (results) ctrl.mailbox.findMessages(ctrl.mailbox.filter, true);
                  else ctrl.getMore();
                }),
              },
              i18n.inbox.older,
            )
          : null,
        ...messageTimeline(results ? (ctrl.mailbox.history ?? []) : convo.msgs, msg => renderMsg(ctrl, msg)),
        ctrl.typing
          ? h(
              'div.msg-typing',
              { attrs: { role: 'status', 'aria-label': i18n.inbox.typing(ctrl.typingNames) } },
              [h('i'), h('i'), h('i')],
            )
          : null,
      ]),
    ],
  );
}

function renderMsg(ctrl: MsgCtrl, msg: Msg) {
  const boards = msg.deleted ? undefined : msg.card?.boards;
  const text = boardMessageText(msg.text, boards);
  const mine = msg.user === ctrl.data.me.id;
  const author = mine
    ? ctrl.data.me
    : (ctrl.data.convo?.members?.find(u => u.id === msg.user) ?? ctrl.data.convo?.user);
  const sender = ctrl.data.names[msg.user] ?? (author?.id === msg.user ? author.name : msg.user);
  const status =
    msg.pending === 'failed'
      ? i18n.inbox.failed
      : msg.pending
        ? i18n.inbox.sending
        : msg.readAt
          ? i18n.inbox.read
          : msg.deliveredAt
            ? i18n.inbox.delivered
            : i18n.inbox.sent;
  function renderMedia() {
    const context = { msg, sender, forward: () => void showForward(ctrl, [msg]) };
    const selecting = ctrl.mailbox.selecting || ctrl.selected.size > 0;
    return msg.card?.preview
      ? messageLinkPreview(context, selecting)
      : messageAttachments(context, selecting);
  }

  return h(
    'article.msg-row',
    {
      key: msg.id,
      class: { mine, their: !mine, selected: ctrl.selected.has(msg.id) },
      attrs: { 'data-message-id': msg.id, tabindex: 0 },
      on: {
        contextmenu: e => {
          e.preventDefault();
          void showMenu(ctrl, msg);
        },
        pointerdown: (e: PointerEvent) => {
          cancelPress(e);
          if (e.pointerType === 'touch')
            presses.set(e.currentTarget!, {
              timer: setTimeout(() => showMenu(ctrl, msg), 450),
              x: e.clientX,
              y: e.clientY,
            });
        },
        pointerup: cancelPress,
        pointercancel: cancelPress,
        pointermove: (e: PointerEvent) => {
          const press = presses.get(e.currentTarget!);
          if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) cancelPress(e);
        },
        click: () => {
          if (ctrl.mailbox.selecting || ctrl.selected.size) ctrl.toggleSelect(msg.id);
        },
        keydown: (e: KeyboardEvent) => {
          if (e.key === 'F10' && e.shiftKey) {
            e.preventDefault();
            void showMenu(ctrl, msg);
          }
        },
      },
    },
    [
      ctrl.mailbox.selecting || ctrl.selected.size
        ? h('input.msg-select', {
            attrs: { type: 'checkbox', checked: ctrl.selected.has(msg.id), 'aria-label': i18n.inbox.select },
            on: { click: e => e.stopPropagation(), change: () => ctrl.toggleSelect(msg.id) },
          })
        : null,
      !mine && ctrl.data.convo?.user.group
        ? userIcon(
            author?.id === msg.user ? author : { id: msg.user, name: msg.user, online: false },
            'msg-author-avatar',
          )
        : undefined,
      h('div.msg-bubble-wrap', [
        h('div.msg-bubble', { class: { deleted: !!msg.deleted } }, [
          msg.forwarded && !msg.deleted
            ? h('small.msg-forwarded', [glyph('forward'), i18n.inbox.forwarded])
            : null,
          msg.reply && !msg.deleted
            ? h(
                'button.msg-quote',
                {
                  on: {
                    click: () =>
                      document
                        .querySelector<HTMLElement>(`[data-message-id="${CSS.escape(msg.reply!.id)}"]`)
                        ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
                  },
                },
                [
                  h('strong', [playerName(msg.reply.user)]),
                  h('span', msg.reply.text || i18n.site.mediaFiles),
                ],
              )
            : null,
          !msg.deleted && (msg.card?.preview || (!msg.pending && msg.attachments?.length))
            ? renderMedia()
            : null,
          h('div.msg-body', [
            !mine && ctrl.data.convo?.user.group
              ? h('strong.msg-author', [playerName(msg.user, ctrl.data.names[msg.user])])
              : undefined,
            renderCard(ctrl, msg),
            msg.deleted
              ? h('t', i18n.inbox.deleted)
              : text && !msg.card?.poll && !msg.card?.contact
                ? renderText(text)
                : null,
            ...(boards?.map((board, index) => messageBoard(board, msg.id + '-' + index)) ?? []),
            h('div.msg-meta', [
              msg.pinnedAt ? glyph('pin') : null,
              msg.editedAt && !msg.deleted
                ? h(
                    'button.msg-edited',
                    {
                      on: {
                        click: e => {
                          e.stopPropagation();
                          void showDetails(ctrl, msg, true);
                        },
                      },
                    },
                    i18n.inbox.edited,
                  )
                : null,
              messageTime(msg.date),
              mine && !msg.deleted
                ? h(
                    'span.msg-receipt',
                    {
                      class: { read: !!msg.readAt, delivered: !!msg.deliveredAt },
                      attrs: { title: status, 'aria-label': status },
                    },
                    [
                      msg.pending
                        ? glyph(msg.pending === 'failed' ? 'failed' : 'clock')
                        : glyph(msg.readAt ? 'read' : msg.deliveredAt ? 'delivered' : 'sent'),
                    ],
                  )
                : null,
            ]),
          ]),
        ]),
        msg.pending === 'failed'
          ? h('button.msg-send-failed', { on: { click: () => ctrl.retry(msg) } }, i18n.inbox.failed)
          : null,
        msg.reactions.length && !msg.deleted
          ? h(
              'div.msg-reactions',
              [...new Set(msg.reactions.map(r => r.emoji))].map(emoji => {
                const users = msg.reactions.filter(r => r.emoji === emoji).map(r => r.user);
                return h(
                  'button',
                  {
                    class: { mine: users.includes(ctrl.data.me.id) },
                    attrs: {
                      title: users.join(', '),
                      'aria-label': `${i18n.inbox.reactions} ${emoji}`,
                    },
                    on: {
                      click: e => {
                        e.stopPropagation();
                        void showMenu(ctrl, msg, true);
                      },
                    },
                  },
                  users.length > 1 ? emoji + ' ' + users.length : emoji,
                );
              }),
            )
          : null,
      ]),
      msg.pending !== 'sending' && !ctrl.mailbox.selecting && !ctrl.selected.size ? toolbar(ctrl, msg) : null,
    ],
  );
}

const renderText = (text: string) =>
  isMoreThanText(text) || text.includes('.')
    ? h('t', {
        key: text,
        hook: {
          create(_, vnode: VNode) {
            const el = vnode.elm as HTMLElement;
            el.innerHTML = enhance(text);
            el.querySelectorAll('img').forEach(c =>
              c.addEventListener('load', scroller.auto, { once: true }),
            );
            $('form.unsub', el).on('submit', function (this: HTMLFormElement) {
              teamUnsub(this);
              return false;
            });
          },
        },
      })
    : h('t', text);

const setupMsgs = (insert: boolean) => (vnode: VNode) => {
  const el = vnode.elm as HTMLElement;
  if (insert) scroller.init(el);
  expandLpvs(el);
  scroller.toMarker() || scroller.auto();
};

const teamUnsub = async (form: HTMLFormElement) => {
  if (await confirm('Unsubscribe?'))
    xhrJson(form.action, {
      method: 'post',
      body: xhrForm({ subscribe: false }),
    }).then(() => alert('Done!'));
};
