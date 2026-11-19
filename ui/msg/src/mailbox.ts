import { chatPath } from 'lib/inboxUrl';
import { form, json } from 'lib/xhr';

import type MsgCtrl from './ctrl';
import type { Msg, Contact, Folder, Organization, User } from './interfaces';
import { upgradeMsg, upgradeContact, upgradeUser } from './network';

export type MailboxPage = 'chats' | 'archive' | 'compose' | 'username' | 'group' | 'folder' | 'members';

export class Mailbox {
  page: MailboxPage = 'chats';
  unread = false;
  folder = '';
  query = '';
  name = '';
  checked = new Set<string>();
  friends?: User[];
  editId = '';
  busy = false;
  mode?: 'search' | 'media' | 'settings';
  filter = '';
  history?: Msg[];
  next?: { before: number; id: string };
  private request = 0;
  private timer?: Timeout;
  openPanel(mode?: Mailbox['mode']) {
    this.mode = mode;
    this.filter = '';
    this.findMessages('');
  }

  findMessages(query: string, older = false) {
    const id = this.ctrl.data.convo?.user.id;
    const number = ++this.request;
    clearTimeout(this.timer);
    this.filter = query;
    if (!older) {
      this.next = undefined;
      this.history = undefined;
    }
    if (id && (this.mode === 'media' || (this.mode === 'search' && query.trim()))) {
      const params = new URLSearchParams({ q: query, files: String(this.mode === 'media') });
      if (older && this.next) {
        params.set('before', String(this.next.before));
        params.set('cursor', this.next.id);
      }
      this.timer = setTimeout(
        async () => {
          try {
            const data = await json('/inbox/history/' + encodeURIComponent(id) + '?' + params);
            if (number !== this.request || this.ctrl.data.convo?.user.id !== id) return;
            this.history = [...(older ? (this.history ?? []) : []), ...data.msgs.map(upgradeMsg)];
            this.next = data.next;
          } catch {
            if (number === this.request) this.ctrl.error = true;
          }
          this.ctrl.redraw();
        },
        older || this.mode === 'media' ? 0 : 180,
      );
    }
    this.ctrl.redraw();
  }

  private extra: Contact[] = [];
  private collectionScope = '';
  private collectionCursor?: number;
  private collecting = false;
  get scope() {
    return this.folder
      ? 'folder/' + this.folder
      : this.page === 'archive'
        ? 'archive'
        : this.unread
          ? 'unread'
          : 'pin';
  }
  get hasMore() {
    return !!this.collectionCursor;
  }
  get contacts() {
    const map = new Map(this.extra.map(c => [c.user.id, c]));
    for (const contact of this.ctrl.data.contacts) map.set(contact.user.id, contact);
    return [...map.values()].sort((a, b) => Number(b.lastMsg.date) - Number(a.lastMsg.date));
  }
  async loadCollection(older = false, force = false) {
    const scope = this.scope;
    if (older && (!this.collectionCursor || this.collecting)) return;
    if (!older && !force && this.collectionScope === scope) return;
    if (!older) {
      this.extra = [];
      this.collectionCursor = undefined;
    }
    this.collectionScope = scope;
    if (scope === 'pin' && !Object.values(this.org.states).some(s => s.pin)) return;
    this.collecting = true;
    try {
      const params = new URLSearchParams({ scope });
      if (older) params.set('before', String(this.collectionCursor));
      const data = await json('/inbox/settings/chats?' + params);
      if (scope !== this.collectionScope) return;
      this.extra.push(...data.contacts.map(upgradeContact));
      this.collectionCursor = data.before;
    } catch {
      if (scope === this.collectionScope) this.ctrl.error = true;
    } finally {
      if (scope === this.collectionScope) {
        this.collecting = false;
        this.ctrl.redraw();
      }
    }
  }
  removeContact(id: string) {
    this.extra = this.extra.filter(c => c.user.id !== id);
  }
  selecting = false;
  constructor(readonly ctrl: MsgCtrl) {}
  get org(): Organization {
    return this.ctrl.data.organization ?? { states: {}, folders: [] };
  }
  state(id: string) {
    return this.org.states[id] ?? {};
  }
  isUnread(c: Contact) {
    return this.state(c.user.id).unread || (!c.lastMsg.read && c.lastMsg.user !== this.ctrl.data.me.id);
  }
  visible(c: Contact) {
    const state = this.state(c.user.id);
    const archived = (state.archive ?? 0) >= c.lastMsg.date.getTime();
    return (
      archived === (this.page === 'archive') &&
      (!this.unread || this.isUnread(c)) &&
      (!this.folder || this.org.folders.find(f => f.id === this.folder)?.chats.includes(c.user.id))
    );
  }

  async go(page: MailboxPage, edit?: Folder) {
    this.page = page;
    if (page === 'archive' || page === 'chats') void this.loadCollection();
    this.query = '';
    this.name = edit?.name ?? '';
    this.editId = edit?.id ?? '';
    this.checked = new Set(edit?.chats);
    this.ctrl.search = { input: '' };
    this.ctrl.error = false;
    this.ctrl.redraw();
    if (['group', 'compose', 'members'].includes(page) && !this.friends) {
      try {
        const data = await json<{ friends: User[] }>('/inbox/contacts/friends');
        this.friends = data.friends.map(upgradeUser);
      } catch {
        this.ctrl.error = true;
      }
      this.ctrl.redraw();
    }
  }

  toggle(id: string) {
    if (this.checked.has(id)) this.checked.delete(id);
    else this.checked.add(id);
    this.ctrl.redraw();
  }

  async change(chat: string, action: string, value: string, members: string[] = []) {
    try {
      this.ctrl.data.organization = await json<Organization>('/inbox/settings/organize', {
        method: 'POST',
        body: form({ chat, action, value, members: members.join(',') }),
      });
      this.ctrl.redraw();
      void this.loadCollection(false, true);
      return true;
    } catch {
      this.ctrl.error = true;
      this.ctrl.redraw();
      return false;
    }
  }

  async manage(action: string, value = '', members: string[] = []) {
    const id = this.ctrl.data.convo?.user.id;
    if (!id || this.busy) return;
    this.busy = true;
    try {
      await json(chatPath(id) + '/manage', {
        method: 'POST',
        body: form({ action, value, members: members.join(',') }),
      });
      if (['delete', 'leave', 'block'].includes(action)) this.ctrl.removeThread(id);
      else await this.ctrl.openConvo(id, true);
    } catch {
      this.ctrl.error = true;
    } finally {
      this.busy = false;
      this.ctrl.redraw();
    }
  }

  async submit() {
    if (this.busy) return;
    if (this.page === 'members') {
      await this.manage('add', '', [...this.checked]);
      await this.go('chats');
      return;
    }
    this.busy = true;
    try {
      if (this.page === 'folder') {
        if (!(await this.change(this.editId, 'folder', this.name.trim(), [...this.checked]))) return;
      } else {
        const data = await json<{ id: string }>('/inbox/groups/create', {
          method: 'POST',
          body: form({ name: this.name.trim(), members: [...this.checked].join(',') }),
        });
        await this.ctrl.openConvo(data.id);
      }
      await this.go('chats');
    } catch {
      this.ctrl.error = true;
    } finally {
      this.busy = false;
      this.ctrl.redraw();
    }
  }
}
