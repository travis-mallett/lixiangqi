import type { LiconValue } from './licon';

export const svgIcon = {
  Challenge: 'challenge-jian',
  Lobby: 'lobby-pavilion',
  Correspondence: 'correspondence-slips',
} as const;

export type DataIcon = LiconValue | (typeof svgIcon)[keyof typeof svgIcon];
