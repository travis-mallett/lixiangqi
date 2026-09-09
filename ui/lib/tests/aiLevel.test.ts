import assert from 'node:assert/strict';
import { test } from 'node:test';

const names = [
  'Newcomer (小白)',
  'Rookie (菜鸟)',
  'Initiate (入门)',
  'Elementary (初级)',
  'Intermediate (中级)',
  'Advanced (高级)',
  'Elite (精英)',
  'Master (大师)',
  'Grandmaster (特级大师)',
];

(globalThis as any).i18n = {
  site: Object.fromEntries(
    names.map((name, index) => [
      `aiLevel${['Newcomer', 'Rookie', 'Initiate', 'Elementary', 'Intermediate', 'Advanced', 'Elite', 'Master', 'Grandmaster'][index]}`,
      name,
    ]),
  ),
};

const { aiLevelName } = await import('../src/game/aiLevel');

test('names all LiXiangQi computer profiles', () => {
  assert.deepEqual(
    names.map((_, index) => aiLevelName(index + 1)),
    names,
  );
});

test('preserves unknown numeric profile ids', () => {
  assert.equal(aiLevelName(10), '10');
});

test('reads the active translation when the locale changes', () => {
  (globalThis as any).i18n.site.aiLevelNewcomer = 'Beginner';
  assert.equal(aiLevelName(1), 'Beginner');
});
