import type { Variant } from './interfaces';

export const variants: Variant[] = [
  {
    id: 1,
    key: 'standard',
    name: i18n.site.xiangqi,
  },
  {
    id: 3,
    key: 'fromPosition',
    name: i18n.variant.fromPosition,
  },
  { id: 1, key: 'jieqi', name: i18n.site.jieqi },
  { id: 1, key: 'minixiangqi', name: i18n.site.miniXiangqi },
  { id: 1, key: 'threeKingdoms', name: i18n.site.threeKingdoms },
];

export const keyToId = (key: string, items: { id: number; key: string }[]): number =>
  items.find(item => item.key === key)!.id;
