import type LobbyController from './ctrl';

export function initAll(ctrl: LobbyController) {
  ctrl.data.seeks.forEach(seek => {
    seek.action = ctrl.me && seek.username === ctrl.me.username ? 'cancelSeek' : 'joinSeek';
  });
}

export function find(ctrl: LobbyController, id: string) {
  return ctrl.data.seeks.find(s => s.id === id);
}
