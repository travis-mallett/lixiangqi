import { openingReferences, renderOpeningReferences, type OpeningReference } from '@lixiangqi/explorer';

import { debounce } from 'lib/async';
import { storedBooleanPropWithEffect } from 'lib/storage';
import type { TreeNode } from 'lib/tree/types';
import { enter } from 'lib/view';

export type WikiTheory = (nodes: TreeNode[]) => void;

export function wikiToggleBox() {
  $('#wikibook-field').each(function (this: HTMLElement) {
    const box = this;
    const state = storedBooleanPropWithEffect('analyse.references.display', true, value =>
      box.classList.toggle('toggle-box--toggle-off', value),
    );
    const toggle = () => state(!state());
    if (!state()) box.classList.add('toggle-box--toggle-off');
    $(box).children('legend').on('click', toggle).on('keypress', enter(toggle));
  });
}

export default function wikiTheory(endpoint: string): WikiTheory {
  const cache = new Map<string, OpeningReference[]>();
  let pending: AbortController | undefined;
  return debounce(
    async (nodes: TreeNode[]) => {
      pending?.abort();
      const root = nodes[0],
        current = nodes[nodes.length - 1];
      if (!root || !current) return;
      const target = document.querySelector<HTMLElement>('.analyse__wiki-text');
      if (!target) return;
      const controller = new AbortController();
      pending = controller;
      $('.analyse__wiki').toggleClass('empty', false);
      target.textContent = i18n.site.loading;
      try {
        let references = cache.get(current.fen);
        if (!references) {
          references = await openingReferences(
            endpoint,
            {
              fen: current.fen,
              initialFen: root.fen,
              ruleset: root.ruleset!,
              moves: nodes.slice(1).map(node => node.uci!),
            },
            controller.signal,
          );
          if (controller.signal.aborted) return;
          cache.set(current.fen, references);
          if (cache.size > 64) cache.delete(cache.keys().next().value!);
        }
        renderOpeningReferences(target, references);
      } catch (error) {
        if (!controller.signal.aborted)
          target.textContent = error instanceof Error ? error.message : String(error);
      }
    },
    500,
    true,
  );
}

export function wikiClear() {
  $('.analyse__wiki').toggleClass('empty', true);
}
