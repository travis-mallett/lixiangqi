import { licon } from 'lib/licon';

import type { GameType, Variant } from './interfaces';

export const variants: Variant[] = [
  {
    id: 1,
    icon: licon.DiscOutline,
    key: 'standard',
    name: i18n.variant.standard,
    description: i18n.variant.standardTitle,
  },
  {
    id: 3,
    icon: licon.Pencil,
    key: 'fromPosition',
    name: i18n.variant.fromPosition,
    description: 'Xiangqi from a custom FEN position',
  },
];

// From-position is selected by the editor links, not offered as a ruleset.
export const variantsForGameType = (baseVariants: Variant[], _gameType: GameType): Variant[] =>
  baseVariants.filter(({ key }) => key === 'standard');

export const keyToId = (key: string, items: { id: number; key: string }[]): number =>
  items.find(item => item.key === key)!.id;
