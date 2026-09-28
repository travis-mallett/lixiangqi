import { attributesModule, classModule, init } from 'snabbdom';

import menuHover from 'lib/menuHover';
import { wsSetActivity } from 'lib/socket';

import PuzzleCtrl from './ctrl';
import type { PuzzleOpts } from './interfaces';
import view from './view/main';

const patch = init([classModule, attributesModule]);

export async function initModule(opts: PuzzleOpts) {
  wsSetActivity('puzzle');

  await site.asset.loadPieces;
  const element = document.querySelector('main.puzzle') as HTMLElement;
  let mounted = false;
  const ctrl = new PuzzleCtrl(opts, redraw);
  const render = () => view(ctrl);

  const blueprint = render();
  element.innerHTML = '';
  let vnode = patch(element, blueprint);
  mounted = true;

  function redraw() {
    if (!mounted) return;
    vnode = patch(vnode, render());
  }

  menuHover();
}
