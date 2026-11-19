import { chatPath } from 'lib/inboxUrl';
import { pubsub } from 'lib/pubsub';
import { json, form } from 'lib/xhr';

import type MsgCtrl from './ctrl';
import type { MsgData, Contact, User, Msg, Convo, SearchResult } from './interfaces';

export async function loadConvo(userId: string): Promise<MsgData> {
  const d = await json(chatPath(userId));
  return upgradeData(d);
}

export async function getMore(userId: string, before: Date): Promise<MsgData> {
  const d = await json(`${chatPath(userId)}?before=${before.getTime()}`);
  return upgradeData(d);
}

export async function loadContacts(): Promise<MsgData> {
  const d = await json(`/inbox`);
  return upgradeData(d);
}

export async function loadMoreContacts(before: Date): Promise<Contact[]> {
  const d = await json(`/inbox?before=${before.getTime()}`);
  return d.contacts.map(upgradeContact);
}

export async function search(q: string): Promise<SearchResult> {
  const res = await json(`/inbox/search?q=${encodeURIComponent(q)}`);
  return {
    ...res,
    friends: res.friends.map(upgradeUser),
    users: res.users.map(upgradeUser),
    contacts: res.contacts.map(upgradeContact),
  } as SearchResult;
}

export function block(u: string) {
  return json(`/api/rel/block/${u}?mini=1`, { method: 'post' });
}

export function unblock(u: string) {
  return json(`/api/rel/unblock/${u}?mini=1`, { method: 'post' });
}

export async function del(u: string): Promise<MsgData> {
  const d = await json(chatPath(u), { method: 'delete' });
  return upgradeData(d);
}

export function report(name: string, msg: Msg): Promise<any> {
  return json('/report/flag', {
    method: 'post',
    body: form({
      username: name,
      item: msg.id,
      revision: msg.revision,
      text: '',
      block: true,
      resource: 'msg',
    }),
  });
}

export async function post(
  dest: string,
  text: string,
  nonce: string,
  replyTo?: string,
  forwardId?: string,
  forwardUser?: string,
  attachments?: string[],
  card?: Msg['card'],
): Promise<Msg> {
  const data = await json(chatPath(dest), {
    method: 'post',
    body: form({
      text,
      nonce,
      replyTo,
      forwardId,
      forwardUser,
      attachments: attachments?.join(','),
      card: card && JSON.stringify(card),
    }),
  });
  return upgradeMsg(data.msg);
}

export function acknowledge(dest: string, ids: string[], read: boolean) {
  return json(`${chatPath(dest)}/receipt`, {
    method: 'post',
    body: form({ ids: ids.join(','), read }),
  });
}

export function typing(dest: string, active = true) {
  return json(`${chatPath(dest)}/typing`, { method: 'post', body: form({ active }) });
}

export async function messageAction(
  dest: string,
  msg: Msg,
  action: string,
  value = '',
  attachments?: string[],
): Promise<Msg> {
  const data = await json(`${chatPath(dest)}/messages/${encodeURIComponent(msg.id)}`, {
    method: 'post',
    body: form({
      action,
      value,
      revision: msg.revision,
      attachments: attachments?.join(','),
      replaceAttachments: attachments !== undefined,
    }),
  });
  return upgradeMsg(data.msg);
}

export function websocketHandler(ctrl: MsgCtrl) {
  pubsub.on('socket.in.msgInbox', e => {
    if (e.organization) {
      ctrl.data.organization = e.organization as import('./interfaces').Organization;
      void ctrl.mailbox.loadCollection(false, true);
      ctrl.redraw();
    } else if (e.user === ctrl.data.convo?.user.id) void ctrl.openConvo(e.user, true);
    else void ctrl.refreshContacts();
  });
  pubsub.on('socket.in.msgChanged', event =>
    ctrl.receiveChange(event.user, upgradeMsg(event.msg), event.kind),
  );
  pubsub.on('socket.in.msgMediaRevoked', ({ user }) => {
    for (const [peer, convo] of ctrl.conversations)
      if (user === ctrl.data.me.id || user === peer) {
        for (const m of [...convo.msgs, ...convo.pinned]) m.attachments = [];
      }
    ctrl.revokeMedia(user);
    if (user === ctrl.data.me.id || user === ctrl.data.convo?.user.id) {
      ctrl.redraw();
      if (ctrl.data.convo) void ctrl.openConvo(ctrl.data.convo.user.id);
    }
  });
  pubsub.on('socket.in.msgReceipt', ctrl.receiveReceipt);
  pubsub.on('socket.in.msgRemoved', event => ctrl.removeMessage(event.user, event.id));
  pubsub.on('socket.in.msgThreadRemoved', event => ctrl.removeThread(event.user));
  pubsub.on('socket.in.msgTyping', event => ctrl.receiveTyping(event.user, !event.active, event.sender));
  pubsub.on('socket.in.msgType', ctrl.receiveTyping);
  pubsub.on('socket.in.blockedBy', ctrl.changeBlockBy);
  pubsub.on('socket.in.unblockedBy', ctrl.changeBlockBy);

  let connected = true;
  pubsub.on('socket.close', () => {
    connected = false;
    ctrl.redraw();
  });
  pubsub.on('socket.open', () => {
    if (!connected) {
      connected = true;
      ctrl.onReconnect();
    }
  });

  return () => connected;
}

// the upgrade functions convert incoming timestamps into JS dates
export function upgradeData(d: any): MsgData {
  return {
    ...d,
    convo: d.convo && upgradeConvo(d.convo),
    contacts: d.contacts.map(upgradeContact),
  };
}
export function upgradeMsg(m: any): Msg {
  return {
    ...m,
    date: new Date(m.date),
    revision: m.revision ?? 0,
    history: (m.history ?? []).map((v: any) => ({ ...v, date: new Date(v.date) })),
    reactions: m.reactions ?? [],
    ...Object.fromEntries(
      ['editedAt', 'deliveredAt', 'readAt', 'deletedAt', 'pinnedAt', 'canEditUntil', 'canDeleteUntil'].map(
        k => [k, m[k] ? new Date(m[k]) : undefined],
      ),
    ),
  };
}
export function upgradeUser(u: any): User {
  return {
    ...u,
    id: u.id || u.name.toLowerCase(),
  };
}
export function upgradeContact(c: any): Contact {
  return {
    ...c,
    user: upgradeUser(c.user),
    lastMsg: upgradeMsg(c.lastMsg),
  };
}
export function upgradeConvo(c: any): Convo {
  return {
    ...c,
    user: upgradeUser(c.user),
    members: c.members?.map(upgradeUser),
    msgs: c.msgs.map(upgradeMsg),
    pinned: (c.pinned ?? []).map(upgradeMsg),
  };
}
