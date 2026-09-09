import { attributesModule, classModule, init } from 'snabbdom';

import menuHover from 'lib/menuHover';
import * as xhr from 'lib/xhr';

import PuzzleCtrl from './ctrl';
import type { PuzzleOpts, NvuiPlugin } from './interfaces';
import { startPuzzlePresence } from './presence';
import view from './view/main';

const patch = init([classModule, attributesModule]);

export async function initModule(opts: PuzzleOpts) {
  startPuzzlePresence(() =>
    xhr.text(`/training/presence/${encodeURIComponent(site.sri)}`, { method: 'post' }),
  );

  await site.asset.loadPieces;
  const element = document.querySelector('main.puzzle') as HTMLElement;
  let mounted = false;
  const ctrl = new PuzzleCtrl(opts, redraw);
  const nvui = site.blindMode && (await site.asset.loadEsm<NvuiPlugin>('puzzle.nvui', { init: ctrl }));
  const render = nvui ? nvui.render : () => view(ctrl);

  const blueprint = render();
  element.innerHTML = '';
  let vnode = patch(element, blueprint);
  mounted = true;

  function redraw() {
    // Starting evaluation can finish while the accessible view is still loading.
    if (!mounted) return;
    vnode = patch(vnode, render());
  }

  menuHover();
}
