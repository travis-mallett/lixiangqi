import { threeKingdoms } from '@lixiangqi/board';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { moveNotation, notationElement, nextTurnSlot } from '../src/notation';
import type { Rules } from '../src/types';

const rules: Rules = (
  await import(new URL('../../../public/three-kingdoms-engine/main.js', import.meta.url).href)
).ThreeKingdoms;
Object.assign(globalThis, {
  i18n: { threeKingdoms: { red: 'Shu', green: 'Wu', black: 'Wei', resign: 'Resigned' } },
});

test('board coordinate labels agree with the canonical rules formatter at every labelled intersection', () => {
  const labels = threeKingdoms.geometry.coordinates!;
  assert.equal(labels.length, 42);
  for (const label of labels)
    assert.equal(label.text, rules.coordinate(label.location)[label.axis === 'file' ? 0 : 1]);
  assert.equal(
    new Set(Object.keys(threeKingdoms.geometry.locations).map(location => rules.coordinate(location))).size,
    135,
  );
});

test('display replaces only the role letter and preserves a complete accessible move', () => {
  const notation = moveNotation(rules, rules.inspect(rules.initial()), 'shu:1:2>wei:7:4');
  const element = notationElement(notation);
  assert.equal(notation.text, 'C2C>8K');
  assert.equal(element.querySelector('.kingdom-piece')?.textContent, '炮');
  assert.equal(element.querySelector('.kingdom-notation__body')?.textContent, '2C>8K');
  assert.equal(element.ariaLabel, 'Shu: C2C>8K');
});

test('a controlled piece retains army identity while its accessible label identifies the controller', () => {
  const state = rules.inspect(rules.initial());
  const notation = moveNotation(rules, state, 'wu:1:0>wu:2:2', 'red');
  const element = notationElement(notation);
  assert.ok(element.querySelector('.kingdom-color--green'));
  assert.ok(element.querySelector('.kingdom-notation__controller.kingdom-color--red'));
  assert.equal(element.ariaLabel, 'Shu (Wu): H2J+3');
  assert.equal(notationElement(moveNotation(rules, state, 'resign', 'black')).textContent, 'Wei: Resigned');
});

test('round slots preserve partial rounds, skipped seats and the final duel', () => {
  const green = nextTurnSlot(undefined, 'green');
  assert.deepEqual(green, { round: 1, column: 1 });
  const black = nextTurnSlot(green, 'black');
  assert.deepEqual(black, { round: 1, column: 2 });
  assert.deepEqual(nextTurnSlot(black, 'green'), { round: 2, column: 1 });
  assert.deepEqual(nextTurnSlot(nextTurnSlot(undefined, 'red'), 'black'), { round: 1, column: 2 });
});
