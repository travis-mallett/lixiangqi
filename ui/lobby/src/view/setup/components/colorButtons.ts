import { blindModeColorPicker, colorButtons as renderButtons } from 'lib/setup/view/color';
import { hl } from 'lib/view';

import type SetupController from '@/setupCtrl';

export const colorButtons = ({ gameType, color }: SetupController) => {
  const randomColorOnly = gameType === 'hook';

  return randomColorOnly
    ? undefined
    : site.blindMode
      ? hl('div', blindModeColorPicker(color))
      : renderButtons(color);
};
