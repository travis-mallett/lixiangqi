import type { Rules } from '../src/types';

/** Compact native placement fixtures are parsed and validated by the production codec. */
export function positionFixture(rules: Rules, initial: string, pieces: string, turn: string): string {
  const fields = initial.split(';');
  fields[1] = String(['black', 'green', 'red'].indexOf(turn));
  fields[9] = pieces;
  fields[10] = '';
  fields[12] = '';
  return rules.validateDiagram(fields.join(';'));
}
