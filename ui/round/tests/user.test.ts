import assert from 'node:assert/strict';
import { test } from 'node:test';

(globalThis as any).i18n = {
  site: {
    aiLevelNewcomer: 'Newcomer (小白)',
    aiLevelRookie: 'Rookie (菜鸟)',
    aiLevelInitiate: 'Initiate (入门)',
    aiLevelElementary: 'Elementary (初级)',
    aiLevelIntermediate: 'Intermediate (中级)',
    aiLevelAdvanced: 'Advanced (高级)',
    aiLevelElite: 'Elite (精英)',
    aiLevelMaster: 'Master (大师)',
    aiLevelGrandmaster: 'Grandmaster (特级大师)',
    anonymous: 'Anonymous',
  },
};

const { userTxt } = await import('../src/view/user');

const player = (extra: Record<string, unknown>) => extra as any;

test('renders computer opponents with their LiXiangQi profile names', () => {
  assert.equal(userTxt(player({ ai: 1 })), 'Newcomer (小白)');
  assert.equal(userTxt(player({ ai: 9 })), 'Grandmaster (特级大师)');
});

test('keeps human and anonymous player names unchanged', () => {
  assert.equal(userTxt(player({ user: { title: 'GM', username: 'Alice' } })), 'GM Alice');
  assert.equal(userTxt(player({})), 'Anonymous');
});
