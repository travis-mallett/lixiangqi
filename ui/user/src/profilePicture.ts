import { domDialog } from 'lib/view';
import * as xhr from 'lib/xhr';

export function initProfilePicture(): void {
  const edit = document.querySelector<HTMLButtonElement>('.profile-picture__edit');
  if (!edit) return;
  const avatar = edit.parentElement!;
  const status = document.createElement('p');
  status.className = 'profile-picture-status';
  status.setAttribute('role', 'status');
  avatar.closest('.user-show__header')!.after(status);
  let generation = 0;

  async function check(id: string, version: number) {
    status.textContent = i18n.site.profilePictureChecking;
    for (let delay = 2000; version === generation && edit?.isConnected; delay = Math.min(15000, delay * 2)) {
      const { state } = await xhr.json<{ state: string }>('/account/profile/picture/' + id);
      if (version !== generation) return;
      if (state === 'ready') {
        const img = document.createElement('img');
        img.alt = '';
        img.src = '/profile/picture/' + id;
        await img.decode();
        if (version !== generation) return;
        avatar.firstElementChild!.replaceWith(img);
        status.textContent = '';
        return;
      }
      if (state !== 'checking') {
        status.textContent =
          state === 'blocked' ? i18n.site.profilePictureRejected : i18n.site.profilePictureUnavailable;
        return;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  const unavailable = () => {
    status.textContent = i18n.site.profilePictureUnavailable;
  };
  if (edit.dataset.pending)
    void check(edit.dataset.pending, generation).catch(() => {
      if (generation === 0) unavailable();
    });

  edit.onclick = async () => {
    const heading = document.createElement('h2');
    heading.textContent = i18n.site.editProfilePicture;
    const help = document.createElement('p');
    help.textContent = i18n.site.profilePictureHelp;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.setAttribute('aria-label', i18n.site.profilePicture);
    const dialog = await domDialog({
      class: 'profile-picture-dialog',
      modal: true,
      append: [heading, help, input].map(node => ({ node })),
    });
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!file.size || file.size > 8 * 1024 * 1024) {
        input.setCustomValidity(i18n.site.profilePictureFormat);
        input.reportValidity();
        return;
      }
      dialog.close();
      const version = ++generation;
      edit.disabled = true;
      status.textContent = i18n.site.profilePictureChecking;
      try {
        const { id } = await xhr.json<{ id: string }>('/account/profile/picture', {
          method: 'POST',
          body: file,
        });
        edit.disabled = false;
        await check(id, version);
      } catch {
        if (version === generation) unavailable();
      } finally {
        if (version === generation) edit.disabled = false;
      }
    };
    await dialog.show();
  };
}
