import { attributesModule, classModule, init } from 'snabbdom';

import { displayColumns, isTouchDevice } from 'lib/device';
import menuHover from 'lib/menuHover';
import { pubsub } from 'lib/pubsub';
import { storage } from 'lib/storage';
import { hl, type VNode, type LooseVNodes } from 'lib/view';
import { toggleZenMode } from 'lib/view/zen';

/** The play room owns presentation and mounting; adapters own rules and transport. */
export function roomView(variant: string, children: LooseVNodes): VNode {
  return hl(
    `div.round__app.variant-${variant}`,
    {
      class: {
        'swap-clock': isTouchDevice() && displayColumns() === 1 && storage.boolean('swapClock').get(),
      },
    },
    children,
  );
}

export function tableView(content: LooseVNodes): LooseVNodes {
  return [hl('div.round__app__table'), content];
}

export function mountRoom(
  element: HTMLElement,
  view: () => VNode,
  onResize: () => void = () => {},
): { redraw: () => void; destroy: () => void } {
  element.replaceChildren();
  const patch = init([classModule, attributesModule]);
  let vnode = patch(element, view());
  let destroyed = false;
  const redraw = () => {
    if (!destroyed) vnode = patch(vnode, view());
  };
  const resize = () => {
    redraw();
    onResize();
  };
  window.addEventListener('resize', resize);
  pubsub.on('zen', toggleZenMode);
  menuHover();
  return {
    redraw,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener('resize', resize);
      pubsub.off('zen', toggleZenMode);
      patch(vnode, hl('div.round__app'));
    },
  };
}
