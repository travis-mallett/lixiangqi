import {
  attributesModule,
  classModule,
  eventListenersModule,
  h,
  init,
  propsModule,
  type VNode,
} from 'snabbdom';

import { globalChatId } from 'lib/inboxUrl';
import { json } from 'lib/xhr';

import MsgCtrl from '../ctrl';
import type { Msg } from '../interfaces';
import { loadConvo, upgradeMsg } from '../network';
import { messageAttachments, messageLinkPreview } from './attachments';
import { renderCard } from './cards';
import { userIcon } from './contact';
import renderConvo from './convo';
import { playerName } from './identity';
import { messageTime, messageTimeline } from './timeline';

type Preview = Omit<Msg, 'reactions'> & { reactions: Record<string, number>; pollCounts?: number[] };

export async function mountGlobalCard(card: HTMLElement) {
  const patch = init([attributesModule, classModule, eventListenersModule, propsModule]);
  const authenticated = card.dataset.auth === 'true';
  let node: Element | VNode = card;
  const render = (children: VNode[]) => {
    node = patch(
      node,
      h(
        'div.lobby__global-chat__room.msg-app.pane-convo',
        { class: { 'msg-preview': !authenticated } },
        children,
      ),
    );
  };
  if (authenticated) {
    const data = await loadConvo(globalChatId, true);
    const redraw = () => render(ctrl.data.convo ? [renderConvo(ctrl, ctrl.data.convo)] : []);
    const ctrl = new MsgCtrl(data, redraw, true);
    const host = card.parentElement!;
    redraw();
    new IntersectionObserver(([entry]) => {
      const resume = entry.isIntersecting && !ctrl.roomVisible;
      ctrl.roomVisible = entry.isIntersecting;
      if (resume && !document.hidden) void ctrl.openConvo(globalChatId, true);
    }).observe(host);
    return;
  }

  let visible = false,
    generation = 0,
    timer: Timeout | undefined,
    previous = '';
  const host = card.parentElement!;
  async function refresh() {
    const current = ++generation;
    clearTimeout(timer);
    if (!visible || document.hidden) return;
    try {
      const { msgs } = await json<{ msgs: Preview[] }>('/inbox/public/global');
      if (current !== generation) return;
      const signature = JSON.stringify(msgs);
      if (signature === previous) return;
      const list = host.querySelector('.msg-app__convo__msgs');
      const follow = !list || list.scrollHeight - list.clientHeight - list.scrollTop < 16;
      previous = signature;
      render([
        h('div.msg-app__convo__msgs', [
          h(
            'div.msg-app__convo__msgs__content',
            msgs.length
              ? messageTimeline(
                  msgs.map(line => ({
                    ...upgradeMsg({ ...line, reactions: [] }),
                    counts: line.reactions ?? {},
                    pollCounts: line.pollCounts,
                  })),
                  row,
                )
              : [h('p', i18n.inbox.noMessagesYet)],
          ),
        ]),
      ]);
      const updated = host.querySelector('.msg-app__convo__msgs')!;
      if (follow) updated.scrollTop = updated.scrollHeight;
    } catch {
      if (current === generation && !previous) render([h('p', i18n.inbox.error)]);
    } finally {
      if (current === generation && visible && !document.hidden) timer = setTimeout(refresh, 8000);
    }
  }
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    void refresh();
  }).observe(host);
  document.addEventListener('visibilitychange', refresh);
}

function row(
  msg: Msg & { counts: Record<string, number>; pollCounts?: number[] },
  first: boolean,
  last: boolean,
) {
  const author = { id: msg.user, name: msg.user, online: false };
  const media = { msg, sender: msg.user };
  const reactions = Object.entries(msg.counts);
  return h('article.msg-row.their', { key: msg.id }, [
    last
      ? userIcon(author, 'msg-author-avatar')
      : h('div.msg-author-avatar-space', { attrs: { 'aria-hidden': 'true' } }),
    h('div.msg-bubble-wrap', [
      h('div.msg-bubble', [
        msg.card?.preview
          ? messageLinkPreview(media, false)
          : msg.attachments?.length
            ? messageAttachments(media, false)
            : undefined,
        h('div.msg-body', [
          first
            ? h('a.msg-author', { attrs: { href: '/@/' + encodeURIComponent(msg.user) } }, [
                playerName(author),
              ])
            : undefined,
          renderCard(undefined, msg, msg.pollCounts),
          msg.text && !msg.card?.poll && !msg.card?.contact ? h('t', msg.text) : undefined,
          h('div.msg-meta', [messageTime(msg.date)]),
        ]),
      ]),
      reactions.length
        ? h(
            'div.msg-reactions',
            reactions.map(([emoji, count]) => h('span', count > 1 ? emoji + ' ' + count : emoji)),
          )
        : undefined,
    ]),
  ]);
}
