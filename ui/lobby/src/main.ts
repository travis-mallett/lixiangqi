import { init, classModule, attributesModule, eventListenersModule, propsModule } from 'snabbdom';

import { domDialog, type Dialog } from 'lib/view';

import makeCtrl from './ctrl';
import type { LobbyOpts } from './interfaces';
import appView from './view/main';
import siteCountersView from './view/siteCounters';
import tableView from './view/table';

export const patch = init([classModule, attributesModule, propsModule, eventListenersModule]);

export default function main(opts: LobbyOpts) {
  const ctrl = new makeCtrl(opts, redraw);

  opts.appElement.innerHTML = '';
  let appVNode = patch(opts.appElement, appView(ctrl));
  let lobbyOverlayOpen = false;
  let lobbyOverlayDialog: Dialog | undefined;
  let afterLobbyClose: (() => void) | undefined;

  ctrl.openLobbyOverlay = () => {
    if (lobbyOverlayOpen) return;
    lobbyOverlayOpen = true;
    void domDialog({
      class: 'lobby__overlay',
      append: [{ node: appVNode.elm as HTMLElement }],
      attrs: { dialog: { 'aria-label': i18n.site.lobby } },
      focus: '[role="tab"]',
      modal: true,
      easyClose: 'clickOutside',
      onClose: () => {
        lobbyOverlayOpen = false;
        lobbyOverlayDialog = undefined;
        const callback = afterLobbyClose;
        afterLobbyClose = undefined;
        if (callback) requestAnimationFrame(callback);
      },
    }).then(dialog => {
      lobbyOverlayDialog = dialog;
      void dialog.show();
      if (afterLobbyClose) dialog.close('setup');
    });
  };

  ctrl.openSetupFromLobby = gameType => {
    const openSetup = () => {
      ctrl.setupCtrl.openModal(gameType);
      redraw();
    };
    if (!lobbyOverlayOpen) return openSetup();
    afterLobbyClose = openSetup;
    lobbyOverlayDialog?.close('setup');
  };

  opts.tableElement.innerHTML = '';
  let tableVNode = patch(opts.tableElement, tableView(ctrl));

  const siteCountersElement = document.querySelector('.lobby__site-counters') as HTMLElement;
  siteCountersElement.innerHTML = '';
  patch(siteCountersElement, siteCountersView(ctrl));

  function redraw() {
    appVNode = patch(appVNode, appView(ctrl));
    tableVNode = patch(tableVNode, tableView(ctrl));
  }
  return ctrl;
}
