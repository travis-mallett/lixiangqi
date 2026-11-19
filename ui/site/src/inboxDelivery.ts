import { chatPath, globalChatId } from 'lib/inboxUrl';
import { pubsub } from 'lib/pubsub';
import { json, form } from 'lib/xhr';

interface Envelope {
  id: string;
  user: string;
}

export function initInboxDelivery(me: string) {
  const delivered = (chat: string, ids: string[]) =>
    json(chatPath(chat) + '/receipt', { method: 'POST', body: form({ ids: ids.join(','), read: false }) });
  let syncing = false;
  const sync = async () => {
    if (syncing) return;
    syncing = true;
    try {
      for (;;) {
        const { msgs } = await json<{ msgs: Envelope[] }>('/inbox/delivery/pending');
        const chats = new Map<string, string[]>();
        for (const msg of msgs) {
          const ids = chats.get(msg.user) ?? [];
          ids.push(msg.id);
          chats.set(msg.user, ids);
        }
        for (const [chat, ids] of chats) await delivered(chat, ids);
        if (msgs.length < 100) break;
      }
    } catch {
      /* The next connection retries unacknowledged envelopes. */
    } finally {
      syncing = false;
    }
  };
  pubsub.on('socket.in.msgChanged', ({ user, kind, msg }) => {
    if (kind === 'new' && user !== globalChatId && msg.user !== me)
      void delivered(user, [msg.id]).catch(() => {});
  });
  pubsub.on('socket.open', sync);
  void sync();
}
