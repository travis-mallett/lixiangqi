import { h, type VNode } from 'snabbdom';

import { spinnerVdom as spinner } from 'lib/view';

import type MsgCtrl from '../ctrl';
import renderConvo from './convo';
import { sidebar } from './sidebar';

export default function (ctrl: MsgCtrl): VNode {
  return h('main.box.msg-app', { class: { [`pane-${ctrl.pane}`]: true } }, [
    h('div.msg-app__side', [...sidebar(ctrl)]),
    ctrl.data.convo
      ? renderConvo(ctrl, ctrl.data.convo)
      : ctrl.loading
        ? h('div.msg-app__convo', { key: ':' }, [h('div.msg-app__convo__head'), spinner()])
        : h('div.msg-empty', ctrl.error ? i18n.inbox.error : i18n.inbox.empty),
  ]);
}
