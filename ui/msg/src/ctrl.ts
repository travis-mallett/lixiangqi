import { throttle } from 'lib/async';
import { AttachmentDraft, submissionError } from 'lib/attachments';
import { chatPath, globalChatId } from 'lib/inboxUrl';
import { storage, type LichessStorage } from 'lib/storage';
import { ValidationError } from 'lib/xhr';

import { BoardDraft } from './boardDraft';
import type { MsgData, Convo, Msg, Receipt, Search, Pane, Redraw } from './interfaces';
import { Mailbox } from './mailbox';
import * as network from './network';
import { PreviewDraft } from './previewDraft';
import { composeCard } from './view/cards';
import { glyphElement } from './view/icons';
import { editPhoto } from './view/photoEditor';
import { scroller } from './view/scroller';

export default class MsgCtrl {
  readonly mailbox = new Mailbox(this);
  readonly preview = new PreviewDraft(this);
  search: Search = { input: '' };
  pane: Pane;
  loading = false;
  loadingContacts = false;
  connected = () => true;
  readonly msgsPerPage = 100;
  canGetMoreSince?: Date;
  roomVisible = true;
  canGetMoreContacts = true;
  private readonly typists = new Map<string, Timeout>();
  get typing() {
    return this.typists.size > 0;
  }
  get typingNames() {
    const convo = this.data.convo;
    return [...this.typists.keys()]
      .map(id => convo?.members?.find(m => m.id === id)?.name ?? convo?.user.name ?? id)
      .join(', ');
  }
  textStore?: LichessStorage;
  replyTo?: Msg;
  editing?: Msg;
  draft = '';
  attachments?: AttachmentDraft;
  boards?: BoardDraft;
  private readonly boardDrafts = new Map<string, BoardDraft>();
  private readonly attachmentDrafts = new Map<string, AttachmentDraft>();
  submissionError = '';
  error = false;
  selected = new Set<string>();
  readonly conversations = new Map<string, Convo>();
  private generation = 0;
  private eventGeneration = 0;
  private sending = false;
  private readonly acknowledging = new Set<string>();
  private readonly duringFetch = new Map<string, Map<string, { msg?: Msg; isNew?: boolean }>>();
  private readonly removedThreads = new Set<string>();
  private forwardKey?: string;
  private readonly forwardNonces = new Map<string, string>();

  constructor(
    public data: MsgData,
    readonly redraw: Redraw,
    readonly compact = false,
  ) {
    this.pane = data.convo ? 'convo' : 'side';
    this.connected = network.websocketHandler(this);
    if (data.convo) {
      this.conversations.set(data.convo.user.id, data.convo);
      this.onLoadConvo(data.convo);
    }
    void this.mailbox.loadCollection();
    setInterval(() => {
      if (this.global && this.roomVisible && this.pane === 'convo' && !document.hidden)
        void network.watchGlobal();
    }, 45000);
    window.addEventListener('focus', this.setRead);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.global && this.roomVisible && this.pane === 'convo')
        void this.openConvo(globalChatId, true);
      else this.setRead();
    });
  }

  get global() {
    return this.data.convo?.user.id === globalChatId;
  }

  openConvo = async (userId: string, refresh = false) => {
    if (this.compact && userId !== globalChatId) {
      location.assign(chatPath(userId));
      return;
    }
    if (refresh && this.data.convo?.user.id !== userId) return;
    if (!refresh) {
      scroller.followNewest();
      this.preview.reset();
      this.mailbox.openPanel();
      this.mailbox.selecting = false;
      this.mailbox.page = this.mailbox.page === 'archive' ? 'archive' : 'chats';
      if (this.mailbox.state(userId).unread) void this.mailbox.change(userId, 'unread', 'false');
      this.removedThreads.delete(userId);
      this.cancelCompose();
      this.selected.clear();
      this.data.convo = this.conversations.get(userId);
      this.pane = 'convo';
      this.loading = !this.data.convo;
      if (this.data.convo) this.onLoadConvo(this.data.convo);
    }
    const generation = ++this.generation;
    const events = this.eventGeneration;
    this.error = false;
    this.redraw();
    const changes = new Map<string, { msg?: Msg; isNew?: boolean }>();
    this.duringFetch.set(userId, changes);
    try {
      const data = await network.loadConvo(userId, this.compact);
      if (generation !== this.generation || this.removedThreads.has(userId)) return;
      if (events === this.eventGeneration) {
        this.data.contacts = data.contacts;
        this.data.organization = data.organization ?? this.data.organization;
        void this.mailbox.loadCollection(false, true);
      }
      if (data.organization) this.data.organization = data.organization;
      this.data.names = data.names;
      if (data.convo) {
        const old = this.conversations.get(userId);
        const msgs = new Map(data.convo.msgs.map(m => [m.id, m]));
        const pins = new Map(data.convo.pinned.map(m => [m.id, m]));
        const oldest = data.convo.msgs[data.convo.msgs.length - 1]?.date;
        for (const m of old?.msgs ?? []) {
          const olderPage =
            refresh && oldest && data.convo.msgs.length === this.msgsPerPage && m.date < oldest;
          if ((m.pending || olderPage) && !msgs.has(m.id)) msgs.set(m.id, m);
        }
        for (const [id, { msg, isNew }] of changes) {
          if (!msg) {
            msgs.delete(id);
            pins.delete(id);
          } else {
            if (isNew || msgs.has(id)) msgs.set(id, msg);
            if (msg.pinnedAt && !msg.deleted) pins.set(id, msg);
            else pins.delete(id);
          }
        }
        data.convo.msgs = [...msgs.values()].sort((a, b) => Number(b.date) - Number(a.date));
        data.convo.pinned = [...pins.values()]
          .sort((a, b) => Number(b.pinnedAt!) - Number(a.pinnedAt!))
          .slice(0, 3);
      }
      this.data.convo = data.convo;
      this.search.result = undefined;
      if (data.convo) {
        this.conversations.set(userId, data.convo);
        if (!this.compact)
          history.replaceState(
            { contact: userId },
            '',
            chatPath(data.convo.user.group ? userId : data.convo.user.name),
          );
        if (refresh) {
          this.acknowledge(data.convo, false);
          requestAnimationFrame(this.setRead);
        } else this.onLoadConvo(data.convo);
      } else this.showSide();
    } catch {
      if (generation === this.generation) this.error = true;
    } finally {
      if (this.duringFetch.get(userId) === changes) this.duringFetch.delete(userId);
      if (generation === this.generation) {
        this.loading = false;
        this.redraw();
      }
    }
  };

  showSide = () => {
    ++this.generation;
    this.stopTyping();
    this.pane = 'side';
    this.loading = false;
    this.redraw();
  };

  getMore = async () => {
    const convo = this.data.convo,
      before = this.canGetMoreSince;
    if (!convo || !before) return;
    this.canGetMoreSince = undefined;
    try {
      const data = await network.getMore(convo.user.id, before);
      if (this.data.convo !== convo || !data.convo) return;
      const ids = new Set(convo.msgs.map(m => m.id));
      convo.msgs.push(...data.convo.msgs.filter(m => !ids.has(m.id)));
      this.canGetMoreSince = data.convo.msgs[this.msgsPerPage - 1]?.date;
      this.acknowledge(convo, false);
    } catch {
      this.canGetMoreSince = before;
      this.error = true;
    }
    this.redraw();
  };

  revokeMedia(user: string): void {
    if (user === this.data.me.id || user === this.data.convo?.user.id) {
      this.preview.reset();
      this.mailbox.openPanel();
    }
    if (this.editing && (user === this.data.me.id || user === this.data.convo?.user.id))
      this.attachments?.revoke();
    for (const [peer, draft] of this.attachmentDrafts)
      if (user === this.data.me.id || user === peer) {
        draft.revoke();
        this.attachmentDrafts.delete(peer);
      }
  }

  private onLoadConvo(convo: Convo) {
    let boards = this.boardDrafts.get(convo.user.id);
    if (!boards) {
      boards = new BoardDraft(this.redraw);
      this.boardDrafts.set(convo.user.id, boards);
    }
    this.boards = boards;
    let attachments = this.attachmentDrafts.get(convo.user.id);
    if (!attachments) {
      attachments = new AttachmentDraft(
        'msg',
        convo.user.id,
        [],
        editPhoto,
        glyphElement,
        type => void composeCard(this, type),
        boards.takeFile,
      );
      this.attachmentDrafts.set(convo.user.id, attachments);
    }
    this.attachments = attachments;
    this.submissionError = '';
    this.textStore = storage.make(`msg:area:${this.data.me.id}:${convo.user.id}`);
    this.draft = this.textStore.get() || '';
    this.boards.update(this.draft);
    this.preview.update(this.draft);
    this.canGetMoreSince = convo.msgs[this.msgsPerPage - 1]?.date;
    for (const timeout of this.typists.values()) clearTimeout(timeout);
    this.typists.clear();
    this.acknowledge(convo, false);
    requestAnimationFrame(this.setRead);
  }

  updateDraft = (text: string) => {
    this.draft = text;
    if (!this.editing) this.boards?.update(text);
    this.preview.update(text);
    if (!this.editing) this.textStore?.set(text);
    if (text.trim()) this.sendTyping();
    else this.stopTyping();
    this.redraw();
  };

  compose = (msg: Msg, edit = false) => {
    this.preview.reset();
    if (this.editing) this.cancelCompose();
    if (edit && this.data.convo)
      this.attachments = new AttachmentDraft(
        'msg',
        this.data.convo.user.id,
        msg.attachments,
        editPhoto,
        glyphElement,
      );
    this.replyTo = edit ? undefined : msg;
    this.editing = edit ? msg : undefined;
    this.draft = edit ? msg.text : this.textStore?.get() || '';
    this.redraw();
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.msg-app textarea')?.focus());
  };

  cancelCompose = () => {
    if (this.editing && this.data.convo) {
      this.attachments?.abandon();
      this.attachments = this.attachmentDrafts.get(this.data.convo.user.id);
    }
    this.replyTo = this.editing = undefined;
    this.draft = this.textStore?.get() || '';
  };

  post = async (text: string): Promise<boolean> => {
    const convo = this.data.convo;
    const boardDraft = this.editing ? undefined : this.boards;
    if (
      !convo ||
      !convo.postable ||
      (!text.trim() && !this.attachments?.active && !boardDraft?.active) ||
      boardDraft?.ready === false ||
      this.attachments?.ready === false ||
      text.length > 8000 ||
      this.sending
    )
      return false;
    const draft = this.attachments;
    const boards = boardDraft?.entries.filter(entry => entry.board);
    const boardSubmission = boards?.length ? boards.map(entry => entry.submission()!) : undefined;
    const preview = boardSubmission ? undefined : this.preview.forSend(text);
    if (preview?.file && draft) draft.stagePreview(preview.file);
    if (draft?.active) {
      this.sending = true;
      let ready = false;
      try {
        ready = await draft.prepare();
      } finally {
        this.sending = false;
      }
      if (
        !ready ||
        this.data.convo !== convo ||
        this.attachments !== draft ||
        text !== this.draft ||
        (preview && this.preview.value !== preview)
      )
        return false;
    }
    if (this.editing) {
      const result = await this.act(this.editing, 'edit', text, this.attachments?.ids);
      if (!result) return false;
      this.cancelCompose();
      this.redraw();
      return true;
    }
    this.submissionError = '';
    const card = boardSubmission
      ? { boards: boards!.map(entry => entry.snapshot()) }
      : preview && { preview: preview.meta };
    const earlier = convo.msgs.find(
      m =>
        m.pending === 'failed' &&
        m.text === text.trim() &&
        JSON.stringify(m.card ?? null) === JSON.stringify(card ?? null) &&
        JSON.stringify(m.boardSubmission) === JSON.stringify(boardSubmission) &&
        m.reply?.id === this.replyTo?.id &&
        (m.attachments ?? []).join(',') === (this.attachments?.ids ?? []).join(','),
    );
    if (earlier) return this.sendPending(convo, earlier);
    const nonce = window.crypto.randomUUID();
    const msg: Msg = {
      id: `${this.data.me.id}_${nonce}`,
      text: text.trim(),
      card,
      boardSubmission,
      attachments: this.attachments?.ids,
      user: this.data.me.id,
      date: new Date(),
      revision: 0,
      history: [],
      reactions: [],
      nonce,
      pending: 'sending',
      reply: this.replyTo && {
        id: this.replyTo.id,
        user: this.replyTo.user,
        text: this.replyTo.text.slice(0, 1000),
      },
    };
    convo.msgs.unshift(msg);
    // Keep the editable draft until the server accepts this nonce.
    this.stopTyping();
    scroller.followNewest();
    this.redraw();
    return this.sendPending(convo, msg);
  };

  async sendCard(card: NonNullable<Msg['card']>, onQueued?: () => void): Promise<boolean> {
    const convo = this.data.convo;
    if (!convo?.postable || this.sending) return false;
    onQueued?.();
    const text = card.poll ? [card.poll.question, ...card.poll.options].join('\n') : '@' + card.contact;
    const failed = convo.msgs.find(
      m => m.pending === 'failed' && m.text === text && JSON.stringify(m.card) === JSON.stringify(card),
    );
    if (failed) return this.sendPending(convo, failed);
    const nonce = window.crypto.randomUUID();
    const msg: Msg = {
      id: this.data.me.id + '_' + nonce,
      nonce,
      text,
      card,
      user: this.data.me.id,
      date: new Date(),
      revision: 0,
      history: [],
      reactions: [],
      pending: 'sending',
    };
    convo.msgs.unshift(msg);
    return this.sendPending(convo, msg);
  }

  discardFailed(msg: Msg) {
    const convo = this.data.convo;
    if (!convo || msg.pending !== 'failed') return;
    convo.msgs = convo.msgs.filter(m => m !== msg);
    this.selected.delete(msg.id);
    this.redraw();
  }

  retry = (msg: Msg) => this.data.convo && this.sendPending(this.data.convo, msg);

  private async sendPending(convo: Convo, msg: Msg): Promise<boolean> {
    if (this.sending) return false;
    this.submissionError = '';
    msg.pending = 'sending';
    this.sending = true;
    this.redraw();
    try {
      const sent = await network.post(
        convo.user.id,
        msg.text,
        msg.nonce!,
        msg.reply?.id,
        undefined,
        undefined,
        msg.attachments,
        msg.card,
        msg.boardSubmission,
      );
      this.attachmentDrafts.get(convo.user.id)?.accepted(msg.attachments ?? []);
      const boards = this.boardDrafts.get(convo.user.id);
      for (const entry of boards?.entries.filter(entry =>
        msg.boardSubmission?.some(board => board.source.value === entry.source.value),
      ) ?? [])
        boards?.remove(entry, false);
      if (this.data.convo?.user.id === convo.user.id) {
        if (!msg.card?.contact && !msg.card?.poll && this.draft.trim() === msg.text) {
          this.preview.reset();
          this.draft = '';
          this.textStore?.remove();
        }
        if (!msg.card?.contact && !msg.card?.poll) this.replyTo = undefined;
      }
      this.receiveChange(convo.user.id, sent, 'new');
      return true;
    } catch (error) {
      this.submissionError =
        error instanceof ValidationError && error.message === 'invalidBoard'
          ? i18n.inbox.invalidBoard
          : submissionError(error);
      if (msg.card?.poll) {
        msg.pending = 'failed';
        this.submissionError = '';
      } else if (error instanceof ValidationError) convo.msgs = convo.msgs.filter(m => m.id !== msg.id);
      else msg.pending = 'failed';
      return false;
    } finally {
      this.sending = false;
      this.redraw();
    }
  }

  receiveChange = (user: string, msg: Msg, kind: string) => {
    if (user === this.data.convo?.user.id && this.mailbox.history)
      this.mailbox.history = this.mailbox.history.flatMap(m =>
        m.id !== msg.id || m.revision > msg.revision ? [m] : msg.deleted ? [] : [msg],
      );
    const convo = this.conversations.get(user);
    const old = convo?.msgs.find(m => m.id === msg.id) ?? convo?.pinned.find(m => m.id === msg.id);
    if (old && old.revision > msg.revision) return;
    this.eventGeneration++;
    msg.deliveredAt ||= old?.deliveredAt;
    msg.readAt ||= old?.readAt;
    const changes = this.duringFetch.get(user);
    changes?.set(msg.id, { msg, isNew: kind === 'new' || changes.get(msg.id)?.isNew });
    if (convo) {
      const index = convo.msgs.findIndex(m => m.id === msg.id);
      if (index >= 0) convo.msgs[index] = msg;
      else if (kind === 'new') {
        convo.msgs.push(msg);
        convo.msgs.sort((a, b) => Number(b.date) - Number(a.date));
        if (this.compact && convo.msgs.length > this.msgsPerPage) convo.msgs.length = this.msgsPerPage;
      }
      convo.pinned = convo.pinned.filter(m => m.id !== msg.id);
      if (msg.pinnedAt && !msg.deleted) convo.pinned.unshift(msg);
      convo.pinned.sort((a, b) => b.pinnedAt!.getTime() - a.pinnedAt!.getTime());
      convo.pinned = convo.pinned.slice(0, 3);
      this.acknowledge(convo, false);
    }
    const contact = this.data.contacts.find(c => c.user.id === user);
    if (contact && ((kind === 'new' && msg.date >= contact.lastMsg.date) || contact.lastMsg.id === msg.id)) {
      contact.lastMsg = { ...msg, read: !!msg.readAt || !!msg.deleted };
      if (kind === 'new') this.data.contacts = [contact, ...this.data.contacts.filter(c => c !== contact)];
    } else if (!this.compact && !contact && kind === 'new') void this.refreshContacts();
    if (user === this.data.convo?.user.id) {
      this.receiveTyping(user, true, msg.user);
      requestAnimationFrame(this.setRead);
    }
    this.redraw();
  };

  receiveReceipt = (event: { user: string; receipts: Receipt[] }) => {
    this.eventGeneration++;
    const convo = this.conversations.get(event.user);
    const receipts = new Map(event.receipts.map(r => [r.id, r]));
    for (const msg of [...(convo?.msgs ?? []), ...(convo?.pinned ?? [])]) {
      const receipt = receipts.get(msg.id);
      if (!receipt) continue;
      if (receipt.deliveredAt) msg.deliveredAt = new Date(receipt.deliveredAt);
      if (receipt.readAt) msg.readAt = new Date(receipt.readAt);
      const changes = this.duringFetch.get(event.user);
      changes?.set(msg.id, { msg, isNew: changes.get(msg.id)?.isNew });
    }
    const contact = this.data.contacts.find(c => c.user.id === event.user);
    const lastId =
      contact?.lastMsg.id ||
      convo?.msgs.find(
        m => m.user === contact?.lastMsg.user && Number(m.date) === Number(contact?.lastMsg.date),
      )?.id;
    const lastReceipt = lastId ? receipts.get(lastId) : undefined;
    if (contact && lastReceipt?.deliveredAt) contact.lastMsg.deliveredAt = new Date(lastReceipt.deliveredAt);
    if (contact && lastReceipt?.readAt) {
      contact.lastMsg.readAt = new Date(lastReceipt.readAt);
      contact.lastMsg.read = true;
    }
    this.redraw();
  };

  removeMessage = (user: string, id: string) => {
    if (user === this.data.convo?.user.id)
      this.mailbox.history = this.mailbox.history?.filter(m => m.id !== id);
    this.eventGeneration++;
    this.duringFetch.get(user)?.set(id, {});
    const convo = this.conversations.get(user);
    if (convo) {
      convo.msgs = convo.msgs.filter(m => m.id !== id);
      convo.pinned = convo.pinned.filter(m => m.id !== id);
    }
    this.selected.delete(id);
    void this.refreshContacts();
    this.redraw();
  };

  act = async (msg: Msg, action: string, value = '', attachments?: string[]): Promise<boolean> => {
    const user = this.data.convo?.user.id;
    if (!user) return false;
    this.error = false;
    try {
      this.submissionError = '';
      const updated = await network.messageAction(user, msg, action, value, attachments);
      if (action === 'deleteMe') this.removeMessage(user, msg.id);
      else this.receiveChange(user, updated, 'update');
      return true;
    } catch (error) {
      this.submissionError = submissionError(error);
      this.error = true;
      this.redraw();
      return false;
    }
  };

  forward = async (messages: Msg[], dest: string): Promise<boolean> => {
    const user = this.data.convo?.user.id;
    if (!user) return false;
    const key = `${user}:${dest}:${messages.map(m => m.id).join(',')}`;
    if (this.forwardKey !== key) {
      this.forwardNonces.clear();
      this.forwardKey = key;
    }
    try {
      for (const msg of messages) {
        const nonce = this.forwardNonces.get(msg.id) ?? window.crypto.randomUUID();
        this.forwardNonces.set(msg.id, nonce);
        await network.post(dest, '', nonce, undefined, msg.id, user);
      }
      this.forwardKey = undefined;
      this.forwardNonces.clear();
      this.selected.clear();
      await this.openConvo(dest);
      return true;
    } catch {
      this.error = true;
      this.redraw();
      return false;
    }
  };

  toggleSelect = (id: string) => {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.redraw();
  };

  private acknowledge(convo: Convo, read: boolean, visibleIds?: Set<string>) {
    if (convo.user.id === globalChatId && !read) return;
    const msgs = convo.msgs.filter(
      m =>
        m.user !== this.data.me.id &&
        !m.deleted &&
        !m.pending &&
        !(read ? m.readAt : m.deliveredAt) &&
        (!visibleIds || visibleIds.has(m.id)),
    );
    for (let offset = 0; offset < msgs.length; offset += 100) {
      const batch = msgs.slice(offset, offset + 100),
        key = `${read}:${batch.map(m => m.id).join(',')}`;
      if (this.acknowledging.has(key)) continue;
      this.acknowledging.add(key);
      void network
        .acknowledge(
          convo.user.id,
          batch.map(m => m.id),
          read,
        )
        .then(data => {
          this.receiveReceipt({ user: convo.user.id, receipts: data.receipts });
        })
        .catch(() => {})
        .finally(() => this.acknowledging.delete(key));
    }
  }

  setRead = () => {
    const convo = this.data.convo;
    if (
      !convo ||
      this.pane !== 'convo' ||
      !document.hasFocus() ||
      document.hidden ||
      document.querySelector('dialog[open]')
    )
      return;
    const viewport = document.querySelector('.msg-app__convo__msgs')?.getBoundingClientRect();
    if (!viewport) return;
    const visible = new Set<string>();
    document.querySelectorAll<HTMLElement>('[data-message-id]').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.bottom > Math.max(0, viewport.top) && rect.top < Math.min(window.innerHeight, viewport.bottom))
        visible.add(el.dataset.messageId!);
    });
    this.acknowledge(convo, true, visible);
  };

  searchInput = async (q: string) => {
    this.search = { input: q };
    if (q.length < 2) {
      this.search.result = undefined;
      this.redraw();
      return;
    }
    try {
      await new Promise(resolve => setTimeout(resolve, 160));
      if (this.search.input !== q) return;
      const result = await network.search(q);
      if (this.search.input === q) this.search.result = result;
    } catch {
      this.error = true;
    }
    this.redraw();
  };

  refreshContacts = async () => {
    if (this.compact) return;
    const events = this.eventGeneration;
    try {
      const data = await network.loadContacts();
      if (events === this.eventGeneration) {
        this.data.contacts = data.contacts;
        this.data.organization = data.organization ?? this.data.organization;
        void this.mailbox.loadCollection(false, true);
      }
      this.redraw();
    } catch {
      /* The next reconnect retries this read. */
    }
  };

  loadMoreContacts = async () => {
    if (this.loadingContacts || !this.canGetMoreContacts) return;
    const last = this.data.contacts[this.data.contacts.length - 1];
    if (!last) return;
    this.loadingContacts = true;
    try {
      const more = await network.loadMoreContacts(last.lastMsg.date);
      this.canGetMoreContacts = more.length >= 30;
      const ids = new Set(this.data.contacts.map(c => c.user.id));
      this.data.contacts.push(...more.filter(c => !ids.has(c.user.id)));
    } catch {
      this.error = true;
    } finally {
      this.loadingContacts = false;
      this.redraw();
    }
  };

  delete = async () => {
    const user = this.data.convo?.user.id;
    if (!user) return;
    try {
      await network.del(user);
      this.removeThread(user);
    } catch {
      this.error = true;
      this.redraw();
    }
  };

  block = () => this.relation(true);
  removeThread = (user: string) => {
    this.mailbox.removeContact(user);
    this.eventGeneration++;
    this.removedThreads.add(user);
    this.conversations.delete(user);
    this.attachmentDrafts.get(user)?.abandon();
    this.attachmentDrafts.delete(user);
    this.boardDrafts.get(user)?.clear();
    this.boardDrafts.delete(user);
    storage.make(`msg:area:${this.data.me.id}:${user}`).remove();
    this.data.contacts = this.data.contacts.filter(c => c.user.id !== user);
    if (this.data.convo?.user.id === user) {
      this.data.convo = undefined;
      this.selected.clear();
      this.cancelCompose();
      this.showSide();
      history.replaceState({}, '', '/inbox');
    }
    this.redraw();
  };
  unblock = () => this.relation(false);
  private async relation(block: boolean) {
    const user = this.data.convo?.user.id;
    if (!user) return;
    try {
      await (block ? network.block(user) : network.unblock(user));
      await this.openConvo(user);
    } catch {
      this.error = true;
      this.redraw();
    }
  }
  changeBlockBy = (user: string) => {
    if (user === this.data.convo?.user.id) void this.openConvo(user, true);
  };

  sendTyping = throttle(3000, () => {
    const user = this.data.convo?.user.id;
    if (user && this.draft.trim()) void network.typing(user).catch(() => {});
  });
  stopTyping = () => {
    const user = this.data.convo?.user.id;
    if (user) void network.typing(user, false).catch(() => {});
  };
  receiveTyping = (user: string, cancel = false, sender = user) => {
    if (user !== this.data.convo?.user.id) return;
    clearTimeout(this.typists.get(sender));
    this.typists.delete(sender);
    if (!cancel)
      this.typists.set(
        sender,
        setTimeout(() => {
          this.typists.delete(sender);
          this.redraw();
        }, 5000),
      );
    this.redraw();
  };
  onReconnect = () => {
    if (this.data.convo) void this.openConvo(this.data.convo.user.id, true);
    else void this.refreshContacts();
  };
}
