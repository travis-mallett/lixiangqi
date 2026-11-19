import { init, classModule, attributesModule, eventListenersModule, propsModule } from 'snabbdom';

import MsgCtrl from './ctrl';
import type { MsgOpts } from './interfaces';
import { upgradeData } from './network';
import { mountGlobalCard } from './view/globalCard';
import view from './view/main';

export async function initModule(opts: MsgOpts | { card: HTMLElement }) {
  if ('card' in opts) return mountGlobalCard(opts.card);
  const element = document.querySelector('.msg-app') as HTMLElement,
    patch = init([classModule, attributesModule, eventListenersModule, propsModule]),
    appHeight = () => document.body.style.setProperty('---app-height', `${window.innerHeight}px`);
  window.addEventListener('resize', appHeight);
  appHeight();
  const ctrl = new MsgCtrl(upgradeData(opts.data), redraw);

  const blueprint = view(ctrl);
  element.innerHTML = '';
  let vnode = patch(element, blueprint);

  function redraw() {
    vnode = patch(vnode, view(ctrl));
  }

  redraw();
}
