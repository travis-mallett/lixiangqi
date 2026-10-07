import assert from 'node:assert/strict';
import { test } from 'node:test';

(globalThis as any).i18n = {
  site: {
    aiNameLevelAiLevel: (name: string, level: number) => `${name} level ${level}`,
    anonymous: 'Anonymous',
  },
};

const { userTxt } = await import('../src/view/user');

const player = (extra: Record<string, unknown>) => extra as any;

test('renders computer opponents with their LiXiangQi profile names', () => {
  assert.equal(userTxt(player({ ai: 1 })), 'Pikafish level 1');
  assert.equal(userTxt(player({ ai: 9 })), 'Pikafish level 9');
});

test('keeps human and anonymous player names unchanged', () => {
  assert.equal(userTxt(player({ user: { title: 'GM', username: 'Alice' } })), 'GM Alice');
  assert.equal(userTxt(player({})), 'Anonymous');
});
