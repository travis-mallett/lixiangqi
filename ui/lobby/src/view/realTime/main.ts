import type LobbyController from '@/ctrl';

import * as list from './list';

export default function (ctrl: LobbyController) {
  return list.render(ctrl, ctrl.stepHooks);
}
