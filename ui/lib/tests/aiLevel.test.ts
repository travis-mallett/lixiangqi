import assert from 'node:assert/strict';
import { test } from 'node:test';

(globalThis as any).i18n = {
  site: { aiNameLevelAiLevel: (name: string, level: number) => `${name} level ${level}` },
};
const { aiCustomLevel, aiCustomLevelIndex, aiCustomLevels, aiLevelName, aiLevels } =
  await import('../src/game/aiLevel');

test('names all 720 computer levels', () => {
  assert.equal(aiLevels.length, 720);
  for (const level of aiLevels) assert.equal(aiLevelName(level), `Pikafish level ${level}`);
});

test('reads the active translation when the locale changes', () => {
  (globalThis as any).i18n.site.aiNameLevelAiLevel = (name: string, level: number) =>
    `${name} niveau ${level}`;
  assert.equal(aiLevelName(720), 'Pikafish niveau 720');
});

test('custom bot choices map to the shared map levels', () => {
  assert.deepEqual(aiCustomLevels, [1, 9, 98, 187, 276, 364, 453, 542, 631, 720]);
  aiCustomLevels.forEach((level, index) => {
    assert.equal(aiCustomLevel(index), level);
    assert.equal(aiCustomLevelIndex(level), index);
  });
  assert.equal(aiCustomLevelIndex(400), 5);
  assert.throws(() => aiCustomLevel(10), RangeError);
});
