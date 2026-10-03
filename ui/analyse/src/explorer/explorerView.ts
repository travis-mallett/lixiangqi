import { h, type VNode } from 'snabbdom';

import type AnalyseCtrl from '@/ctrl';

export default function explorerView(ctrl: AnalyseCtrl): VNode | undefined {
  if (!ctrl.explorer.enabled()) return;
  return h('div.explorer-box', {
    hook: {
      insert: vnode => ctrl.explorer.mount(vnode.elm as HTMLElement),
      postpatch: () => ctrl.explorer.setNode(),
      destroy: () => ctrl.explorer.destroy(),
    },
  });
}
