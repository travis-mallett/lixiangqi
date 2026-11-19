export const globalChatId = '~00000000000000000000000000000000';

export const chatPath = (id: string): string =>
  '/inbox/' + (id.startsWith('~') ? 'group/' : '') + encodeURIComponent(id);
