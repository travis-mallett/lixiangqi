export const chatPath = (id: string): string =>
  '/inbox/' + (id.startsWith('~') ? 'group/' : '') + encodeURIComponent(id);
