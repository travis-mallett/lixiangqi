import { licon, type LiconValue } from 'lib/licon';

import type { GameMode, GameType, Variant } from './interfaces';

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

export const variantsWhereWhiteIsBetter: VariantKey[] = [];

export const speeds: { key: Speed; name: string; icon: LiconValue }[] = [
  { icon: licon.UltraBullet, key: 'ultraBullet', name: i18n.site.ultraBullet },
  { icon: licon.Bullet, key: 'bullet', name: i18n.site.bullet },
  { icon: licon.FlameBlitz, key: 'blitz', name: i18n.site.blitz },
  { icon: licon.Rabbit, key: 'rapid', name: i18n.site.rapid },
  { icon: licon.Turtle, key: 'classical', name: i18n.site.classical },
  { icon: licon.PaperAirplane, key: 'correspondence', name: i18n.site.correspondence },
];

export const keyToId = (key: string, items: { id: number; key: string }[]): number =>
  items.find(item => item.key === key)!.id;

export const gameModes: { key: GameMode; name: string }[] = [
  { key: 'casual', name: i18n.site.casual },
  { key: 'rated', name: i18n.site.rated },
];
