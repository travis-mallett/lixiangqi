import { hl } from 'lib/view/snabbdom';

import { playerProfileLink } from './identity';

export const welcomeRow = (id: string, name: string) =>
  hl(
    'article.msg-welcome',
    { key: id, attrs: { 'data-message-id': id } },
    i18n.inbox.welcomeUser.asArray(playerProfileLink(name)),
  );
