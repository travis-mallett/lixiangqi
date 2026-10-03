import { requestXiangqi } from 'lib/game/xiangqiApi';

import type { ExplorerData, ExplorerPosition } from './interfaces';

export interface OpeningReference {
  gameId: string;
  title: string;
  opening?: string;
  commentary?: string;
  reference?: string;
  sourceUrl?: string;
}

/** Educational source records indexed at this native position, independent of displayed move notation. */
export async function openingReferences(
  endpoint: string,
  position: ExplorerPosition,
  signal?: AbortSignal,
): Promise<OpeningReference[]> {
  const data = await requestXiangqi<ExplorerData>(
    `${endpoint.replace(/\/$/, '')}/explorer`,
    {
      ...position,
      database: 'all',
    },
    signal,
  );
  if (!data.available) throw new Error(data.error || i18n.study.referenceUnavailable);
  const games = new Map([...data.topGames, ...data.recentGames].map(game => [game.id, game]));
  return [...games.values()]
    .filter(game => game.metadata?.opening || game.metadata?.remark || game.metadata?.reference)
    .map(game => ({
      gameId: game.id,
      title: game.metadata?.title || `${game.red.name} – ${game.black.name}`,
      opening: game.metadata?.opening,
      commentary: game.metadata?.remark,
      reference: game.metadata?.reference,
      sourceUrl: /^https?:\/\//.test(game.sourceUrl) ? game.sourceUrl : undefined,
    }));
}

export function renderOpeningReferences(target: HTMLElement, references: OpeningReference[]): void {
  target.replaceChildren();
  const paragraph = (text: string) => {
    const node = document.createElement('p');
    node.textContent = text;
    return node;
  };
  target.append(
    paragraph(references.length ? i18n.study.positionReferences : i18n.study.noPositionReference),
  );
  for (const reference of references) {
    const article = document.createElement('article');
    const heading = document.createElement('h3');
    heading.textContent = reference.opening || reference.title;
    article.append(heading);
    if (reference.commentary) article.append(paragraph(reference.commentary));
    if (reference.reference) article.append(paragraph(reference.reference));
    const game = document.createElement('a');
    game.href = `/analysis?game=${encodeURIComponent(reference.gameId)}`;
    game.textContent = reference.title;
    article.append(game);
    if (reference.sourceUrl) {
      const source = document.createElement('a');
      source.href = reference.sourceUrl;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      source.textContent = i18n.study.referenceSource;
      article.append(document.createTextNode(' · '), source);
    }
    target.append(article);
  }
}
