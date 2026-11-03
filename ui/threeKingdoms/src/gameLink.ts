import { pubsub } from 'lib/pubsub';

import { el, link } from './dom';
import type { Game } from './types';

export function gameLink(game: Game): HTMLElement {
  const text = game.seats
    .map(
      s =>
        `${s.user?.name ?? (s.guest ? i18n.site.anonymous : `${i18n.threeKingdoms.computer} ${s.aiLevel}`)}${s.place ? ` (${s.place})` : ''}`,
    )
    .join(' · ');
  const local = game.id.startsWith('local-');
  const row = link(
    text,
    local ? `/analysis/threeKingdoms?game=${game.id}` : `/three-kingdoms/game/${game.id}`,
    'three-kingdoms__game',
  );
  const preview = el('div', 'three-kingdoms__preview');
  preview.dataset.threeKingdomsPosition = game.position;
  row.prepend(preview);
  void site.asset.loadEsm('threeKingdoms.mini').then(() => pubsub.emit('content-loaded'));
  row.append(
    el(
      'small',
      '',
      `${new Date(game.createdAt).toLocaleString()} · ${game.rated ? i18n.threeKingdoms.rated : i18n.threeKingdoms.casual}`,
    ),
  );
  return row;
}
