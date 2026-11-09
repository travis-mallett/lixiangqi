import { init, toVNode, classModule, attributesModule, eventListenersModule, propsModule } from 'snabbdom';

import { domDialog, type Dialog } from 'lib/view';

import makeCtrl from './ctrl';
import type { LobbyOpts } from './interfaces';
import { fitLeaderboards } from './leaderboard';
import { makeCarousel } from './view/carousel';
import appView from './view/main';
import { occupancy } from './view/occupancy';
import siteCountersView from './view/siteCounters';
import tableView from './view/table';
import variantMenu from './view/variantMenu';

export const patch = init([classModule, attributesModule, propsModule, eventListenersModule]);

export default function main(opts: LobbyOpts) {
  makeCarousel({ selector: '.lobby__blog', itemWidth: 192, pauseFor: 10 });
  fitLeaderboards();
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
      ctrl.setupCtrl.openModal(gameType, ctrl.lobbyVariant ? { variant: ctrl.lobbyVariant } : undefined);
      redraw();
    };
    if (!lobbyOverlayOpen) return openSetup();
    afterLobbyClose = openSetup;
    lobbyOverlayDialog?.close('setup');
  };

  let tableVNode = patch(toVNode(opts.tableElement), tableView(ctrl));
  const centerRailElement = opts.tableElement.closest('.lobby__center-rail');
  syncHomepageRoomLayout();

  const siteCountersElement = document.querySelector('.lobby__site-counters') as HTMLElement;
  siteCountersElement.innerHTML = '';
  let siteCountersVNode = patch(siteCountersElement, siteCountersView(ctrl));

  const variantMenus = (['jieqi', 'minixiangqi', 'manchu', 'threeKingdoms'] as const).map(variant => {
    let vnode: ReturnType<typeof variantMenu> | undefined;
    let dialog: Dialog | undefined;
    let opening = false;
    let afterClose: (() => void) | undefined;
    const navigate = (action: () => void) => {
      afterClose = action;
      dialog?.close();
    };
    const trigger = document.querySelector<HTMLAnchorElement>(
      `.lobby__variant-card[href="/?variant=${variant}"]`,
    );
    let counter = trigger
      ? patch(trigger.appendChild(document.createElement('span')), occupancy(ctrl.poolCount(variant)))
      : undefined;
    const open = () => {
      if (opening || dialog) return;
      opening = true;
      vnode = patch(document.createElement('div'), variantMenu(ctrl, variant, navigate));
      void domDialog({
        class: 'lobby__variant-menu-dialog',
        append: [{ node: vnode.elm as HTMLElement }],
        attrs: { dialog: { 'aria-labelledby': 'variant-menu-title' } },
        modal: true,
        easyClose: 'clickOutside',
        onClose: () => {
          vnode = undefined;
          dialog = undefined;
          trigger?.focus();
          const action = afterClose;
          afterClose = undefined;
          if (action) requestAnimationFrame(action);
        },
      }).then(created => {
        opening = false;
        dialog = created;
        void created.show();
      });
    };
    trigger?.setAttribute('aria-haspopup', 'dialog');
    trigger?.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      open();
    });
    if (new URLSearchParams(location.search).get('variant') === variant && !location.hash) open();
    return () => {
      if (counter) counter = patch(counter, occupancy(ctrl.poolCount(variant)));
      if (vnode) vnode = patch(vnode, variantMenu(ctrl, variant, navigate));
    };
  });

  function redraw() {
    variantMenus.forEach(redrawMenu => redrawMenu());
    appVNode = patch(appVNode, appView(ctrl));
    tableVNode = patch(tableVNode, tableView(ctrl));
    siteCountersVNode = patch(siteCountersVNode, siteCountersView(ctrl));
    syncHomepageRoomLayout();
  }

  function syncHomepageRoomLayout() {
    centerRailElement?.classList.toggle(
      'lobby__center-rail--homepage-room',
      !!ctrl.homepageRoom || ctrl.botMapOpen,
    );
  }
  return ctrl;
}
