import { h, type VNode } from 'snabbdom';

// Code points in the bundled Signal Symbols font. See public/font/signal-symbols/NOTICE.txt.
const symbols = {
  settings: '\uE0CA',
  mute: '\uE01F',
  menu: '\uE2AF',
  outline: '\uE14E',
  highlight: '\uE1DE',
  plainText: '\uE14D',
  heavy: '\uE0DE',
  medium: '\uE0DF',
  regular: '\uE0E0',
  thin: '\uE0E1',
  at: '\uE01B',
  bell: '\uE01E',
  search: '\uE0C7',
  group: '\uE19B',
  unarchive: '\uE09C',
  archive: '\uE09B',
  folder: '\uE0B3',
  filter: '\uE107',
  message: '\uE0A6',
  compose: '\uE0EA',
  react: '\uE0B7',
  smiley: '\uE18D',
  reply: '\uE06D',
  forward: '\uE035',
  more: '\uE120',
  copy: '\uE0EB',
  select: '\uE022',
  info: '\uE03B',
  pin: '\uE12E',
  unpin: '\uE12F',
  delete: '\uE0D5',
  edit: '\uE030',
  close: '\uE1ED',
  check: '\uE180',
  download: '\uE0C8',
  send: '\uE0C9',
  clock: '\uE044',
  failed: '\uE11A',
  sent: '\uE022',
  delivered: '\uE046',
  read: '\uE047',
  plus: '\uE1D1',
  file: '\uE034',
  fileFill: '\uE190',
  poll: '\uE082',
  contact: '\uE05E',
  photo: '\uE065',
  prev: '\uE024',
  next: '\uE025',
  block: '\uE002',
  report: '\uE105',
  pen: '',
  highlighter: '',
  marker: '\uE0F7',
  text: '\uE14E',
  sticker: '\uE070',
  crop: '\uE0EE',
  rotate: '\uE137',
  undo: '\uE0C5',
  redo: '\uE0C6',
} as const;

export type Glyph = keyof typeof symbols;

const rtl: Partial<Record<Glyph, string>> = {
  reply: '\uE2F7',
  forward: '\uE2E1',
  prev: '\uE025',
  next: '\uE024',
  undo: '\uE302',
  redo: '\uE2F6',
};

const symbol = (name: Glyph) => (document.documentElement.dir === 'rtl' && rtl[name]) || symbols[name];

export const glyph = (name: Glyph): VNode =>
  h('span.msg-glyph', { attrs: { 'aria-hidden': 'true' } }, symbol(name));

export function glyphElement(name: Glyph): HTMLElement {
  const el = document.createElement('span');
  el.className = 'msg-glyph';
  el.setAttribute('aria-hidden', 'true');
  if (name === 'pen' || name === 'highlighter') {
    el.style.cssText = 'width:1em;height:1em;display:inline-block;background:currentColor';
    el.style.mask =
      'url(' + site.asset.url('images/inbox-media/brush-' + name + '.svg') + ') center / contain no-repeat';
  } else el.textContent = symbol(name);
  return el;
}
