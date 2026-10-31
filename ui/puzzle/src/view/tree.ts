import { AnalysisTreeView } from 'xiangqi';

import { hl, type VNode } from 'lib/view';

import type PuzzleCtrl from '../ctrl';

const views = new WeakMap<Node, { render: () => void; destroy: () => void }>();

export function render(ctrl: PuzzleCtrl): VNode {
  const mount = (vnode: VNode) => {
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
    let frame = 0;
    const reveal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => view.scrollToActive());
    };
    const render = () => {
      const scroll = ctrl.autoScrollRequested || ctrl.autoScrollNow;
      view.render({ scrollToActive: false });
      ctrl.autoScrollRequested = ctrl.autoScrollNow = false;
      if (scroll) reveal();
    };
    // Initial board/engine layout can settle after the tree's insert hook.
    const observer = new ResizeObserver(reveal);
    observer.observe(vnode.elm as HTMLElement);
    const media = window.matchMedia('(max-width: 799px)');
    const resize = () => {
      render();
      reveal();
    };
    media.addEventListener('change', resize);
    views.set(vnode.elm!, {
      render,
      destroy: () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        media.removeEventListener('change', resize);
        view.closeMenu();
      },
    });
    render();
    reveal();
  };
  return hl('div.puzzle__moves.xiangqi-analysis__moves.two-column-notation', {
    hook: {
      insert: mount,
      postpatch: (_, vnode) => views.get(vnode.elm!)?.render(),
      destroy: vnode => views.get(vnode.elm!)?.destroy(),
    },
  });
}
