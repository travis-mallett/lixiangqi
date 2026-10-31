import { el, button, request, errorText } from 'threeKingdoms';

import type { ChatCtrl, Line } from 'lib/chat/interfaces';
import standaloneChat from 'lib/chat/standalone';

interface ChatData {
  lines: Line[];
  room?: string;
  writeable: boolean;
  hidden?: boolean;
}

/** Adapt the three-seat HTTP rooms to the same chat UI used by every round. */
export class Chat {
  private readonly root = el('div', 'round__chat');
  private readonly error = el('p', 'error');
  private ctrl?: ChatCtrl;
  private timer?: ReturnType<typeof setTimeout>;
  private destroyed = false;
  private room?: string;
  private signature = '';
  private sending = false;

  constructor(
    parent: HTMLElement,
    private readonly id: string,
    private readonly userId: string | null,
  ) {
    parent.append(this.root);
    void this.poll();
  }

  private async poll(): Promise<void> {
    if (this.destroyed) return;
    if (!document.hidden) {
      try {
        const data = await request<ChatData>(`game/${this.id}/chat`);
        if (this.destroyed) return;
        this.root.hidden = !!data.hidden;
        if (!data.hidden) {
          const signature = JSON.stringify(data);
          if (!this.ctrl || this.room !== data.room) {
            this.ctrl?.destroy();
            this.room = data.room;
            const host = el('section', 'mchat');
            this.root.replaceChildren(host, this.error);
            this.ctrl = standaloneChat({
              el: host,
              data: {
                id: `3k:${this.id}:${data.room}`,
                name: data.room === 'player' ? i18n.site.chatRoom : i18n.site.spectatorRoom,
                lines: data.lines,
                userId: this.userId ?? undefined,
                resourceType: 'threeKingdoms',
                resourceId: `threeKingdoms/${this.id}`,
                loginRequired: true,
                restricted: false,
                voiceChat: false,
              },
              writeable: data.writeable,
              public: data.room !== 'player',
              permissions: {},
              kobold: false,
              blind: !!site.blindMode,
              timeout: false,
              kidMode: false,
              post: text => {
                if (this.sending || this.destroyed) return false;
                void this.submit(text);
                return true;
              },
            });
          } else if (signature !== this.signature) {
            this.ctrl.data.lines = data.lines;
            this.ctrl.vm.writeable = data.writeable;
            this.ctrl.vm.domVersion++;
            this.ctrl.redraw();
          }
          this.signature = signature;
        }
      } catch {
        // Keep the last visible messages while the connection recovers.
      }
    }
    if (!this.destroyed) this.timer = setTimeout(() => void this.poll(), 5000);
  }

  private async submit(text: string): Promise<void> {
    this.sending = true;
    try {
      await request(`game/${this.id}/chat`, { text });
      if (!this.destroyed) this.error.replaceChildren();
    } catch (error) {
      if (!this.destroyed)
        this.error.replaceChildren(
          document.createTextNode(errorText(error)),
          button(i18n.threeKingdoms.retry, () => {
            if (!this.sending) void this.submit(text);
          }),
        );
    } finally {
      this.sending = false;
    }
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.ctrl?.destroy();
    this.root.remove();
  }
}
