import { redirectFirst } from 'lib/tournament';

import type TournamentController from './ctrl';

export interface TournamentSocket {
  send: SocketSend;
  receive(type: string, data: any): void;
}

export function makeSocket(send: SocketSend, ctrl: TournamentController) {
  const handlers = {
    reload: ctrl.askReload,
    redirect(fullId: string) {
      redirectFirst(fullId.slice(0, 8), true);
      return true; // prevent default redirect
    },
    redirectKingdoms(id: string) {
      redirectFirst(id, true, `/three-kingdoms/game/${id}`);
      return true;
    },
  };

  return {
    send,
    receive(type: string, data: any) {
      const handler = (handlers as SocketHandlers)[type];
      if (handler) return handler(data);
      return false;
    },
  };
}
