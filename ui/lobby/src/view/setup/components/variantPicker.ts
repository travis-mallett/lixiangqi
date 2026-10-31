import { option } from 'lib/setup/option';
import { hl } from 'lib/view';

import type { SetupVariant } from '@/interfaces';
import type SetupController from '@/setupCtrl';

import { variants } from '../../../options';

export const variantPicker = (setupCtrl: SetupController) =>
  hl('div.variant.label-select', [
    hl('label', { attrs: { for: 'sf_variant' } }, i18n.site.variant),
    hl(
      'select#sf_variant',
      {
        on: {
          change: (event: Event) =>
            setupCtrl.variant((event.target as HTMLSelectElement).value as SetupVariant),
        },
      },
      variants
        .filter(variant => setupCtrl.gameType !== 'hook' || variant.key !== 'threeKingdoms')
        .filter(variant => variant.key !== 'fromPosition' || setupCtrl.variant() === 'fromPosition')
        .map(variant => option(variant, setupCtrl.variant())),
    ),
  ]);
