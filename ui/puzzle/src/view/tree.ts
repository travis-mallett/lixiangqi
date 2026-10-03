import { AnalysisTreeView } from 'xiangqi';

import { hl, type VNode } from 'lib/view';

import type PuzzleCtrl from '../ctrl';

const cleanups = new WeakMap<Node, () => void>();

export function render(ctrl: PuzzleCtrl): VNode {
  const render = (vnode: VNode) => {
    const view = new AnalysisTreeView({
      element: vnode.elm as HTMLElement,
      tree: () => ctrl.tree,
      activePath: () => ctrl.path,
      notationLayout: () => 'two-column',
      navigate: path => {
        ctrl.userJump(path);
        ctrl.redraw();
      },
      setActivePath: () => {},
      commit: () => {},
      readOnly: true,
      notationStyle: () => ctrl.pref.notationStyle,
      emptyText: '',
    });
    view.render({ scrollToActive: ctrl.autoScrollRequested || ctrl.autoScrollNow });
    ctrl.autoScrollRequested = ctrl.autoScrollNow = false;
  };
  return hl('div.puzzle__moves.xiangqi-analysis__moves.two-column-notation', {
    hook: {
      insert: vnode => {
        render(vnode);
        const media = window.matchMedia('(max-width: 799px)');
        const resize = () => render(vnode);
        media.addEventListener('change', resize);
        cleanups.set(vnode.elm!, () => media.removeEventListener('change', resize));
      },
      postpatch: (_, vnode) => render(vnode),
      destroy: vnode => cleanups.get(vnode.elm!)?.(),
    },
  });
}
