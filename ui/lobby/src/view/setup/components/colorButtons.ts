import { colors } from 'lib/setup/color';
import { blindModeColorPicker, colorButtons as renderButtons } from 'lib/setup/view/color';
import { hl } from 'lib/view';

import type SetupController from '@/setupCtrl';

export const colorButtons = ({ gameType, color, gameVariant }: SetupController) => {
  const randomColorOnly = gameType === 'hook';

  const choices =
    gameVariant() === 'banqi'
      ? colors.map(c => ({
          ...c,
          name:
            c.key === 'white'
              ? i18n.site.banqiFirstSeat
              : c.key === 'black'
                ? i18n.site.banqiSecondSeat
                : i18n.site.randomColor,
        }))
      : colors;
  return randomColorOnly
    ? undefined
    : site.blindMode
      ? hl('div', blindModeColorPicker(color, choices))
      : renderButtons(color, choices);
};
