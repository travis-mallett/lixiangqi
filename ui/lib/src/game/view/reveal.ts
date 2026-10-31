import { standardXiangqi } from '@lixiangqi/board';

import { domDialog } from '../../view';
import { randomReveal, type RevealChoice } from '../jieqi';

export function jieqiRoleName(role: string): string {
  const names: Record<string, string> = {
    chariot: i18n.site.jieqiChariot,
    horse: i18n.site.jieqiHorse,
    elephant: i18n.site.jieqiElephant,
    advisor: i18n.site.jieqiAdvisor,
    cannon: i18n.site.jieqiCannon,
    soldier: i18n.site.jieqiSoldier,
  };
  return names[role] ?? role;
}

/** Analysis selects a hypothetical outcome. Live play never asks the browser for an identity. */
export async function chooseReveal(
  outcomes: readonly RevealChoice[],
  side: 'red' | 'black',
): Promise<string | undefined> {
  const content = document.createElement('div');
  const heading = document.createElement('h2');
  heading.textContent = i18n.site.chooseReveal;
  content.append(heading);
  const choices = document.createElement('div');
  choices.className = 'jieqi-reveal-choices';
  const percent = new Intl.NumberFormat(document.documentElement.lang || undefined, {
    style: 'percent',
    maximumFractionDigits: 1,
  });
  for (const { role, probability } of outcomes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-empty';
    button.dataset.role = role;
    const piece = document.createElement('piece');
    piece.className = (side === 'red' ? 'white ' : 'black ') + standardXiangqi.roles[role] + '-piece';
    button.append(piece, document.createTextNode(`${jieqiRoleName(role)} (${percent.format(probability)})`));
    choices.append(button);
  }
  content.append(choices);
  const randomButton = document.createElement('button');
  randomButton.type = 'button';
  randomButton.className = 'button jieqi-reveal-random';
  randomButton.dataset.randomReveal = '';
  randomButton.textContent = i18n.site.randomReveal;
  content.append(randomButton);
  const dialog = await domDialog({
    append: [{ node: content }],
    modal: true,
    show: true,
    focus: 'button',
    actions: {
      selector: '[data-role], [data-random-reveal]',
      listener: (event, dialog) => {
        const target = event.currentTarget as HTMLElement;
        dialog.close(
          target.hasAttribute('data-random-reveal') ? randomReveal(outcomes) : target.dataset.role,
        );
      },
    },
  });
  return outcomes.some(choice => choice.role === dialog.returnValue) ? dialog.returnValue : undefined;
}
