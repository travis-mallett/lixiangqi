import type { Entry } from '../interfaces';

// Completes the existing voice lexicons for Xiangqi's ninth file and tenth rank.
const ranks: Record<string, readonly [string, string]> = {
  en: ['nine', 'ten'],
  fr: ['neuf', 'dix'],
  pl: ['dziewięć', 'dziesięć'],
  de: ['neun', 'zehn'],
  tr: ['dokuz', 'on'],
  vi: ['chín', 'mười'],
  ru: ['девять', 'десять'],
  it: ['nove', 'dieci'],
  sv: ['nio', 'tio'],
};

export function extraCoordinates(language: string): Entry[] {
  const words = ranks[language];
  if (!words) throw new Error(`Missing Xiangqi voice coordinates for ${language}`);
  return [
    { in: 'i', tok: 'i', tags: ['file', 'move'] },
    ...words.map((word, index) => ({ in: word, tok: String(index + 9), tags: ['rank', 'move'] })),
  ];
}
