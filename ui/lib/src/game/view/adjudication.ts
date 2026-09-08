import { h, type VNode } from 'snabbdom';

import { adjudicationText } from '../adjudication';

export interface AdjudicationPosition {
  variation?: string | null;
  termination?: string | null;
}

/** Shared live-play and teaching presentation. Keep adjudication UI behavior here. */
export function renderAdjudication(state: AdjudicationPosition, visible = true): VNode | undefined {
  const text = visible && adjudicationText(state.termination || state.variation);
  return text
    ? h('div.round__adjudication', { attrs: { role: 'status', 'aria-live': 'polite' } }, text)
    : undefined;
}
