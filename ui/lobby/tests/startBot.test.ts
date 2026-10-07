import assert from 'node:assert/strict';
import { test, mock } from 'node:test';

import { aiCustomLevels } from 'lib/game';

import SetupController from '../src/setupCtrl';

test('map games use their level and standard defaults without overwriting custom bot settings', async () => {
  const root = {
    me: { username: 'bot-map-test' },
    pools: [],
    redraw() {},
    hasOngoingRealTimeGame: () => false,
  } as any;
  const ctrl = new SetupController(root);
  ctrl.aiStats = {
    levels: [
      {
        level: 719,
        mine: { wins: 1, draws: 0, losses: 0, games: 1 },
        registered: { wins: 1, draws: 0, losses: 0, games: 1 },
      },
    ],
  };
  const saved = {
    ...ctrl.store.ai(),
    aiLevel: 400,
    color: 'black' as const,
    timeMode: 'realTime' as const,
    time: 10,
    aiTimeControls: true,
  };
  ctrl.store.ai(saved);
  const storedBefore = ctrl.store.ai();
  let submitted = false;
  ctrl.submit = async () => {
    submitted = true;
    assert.equal(ctrl.aiLevel(), 720);
    assert.equal(ctrl.variant(), 'standard');
    assert.equal(ctrl.timeControl.mode(), 'unlimited');
    assert.equal(ctrl.color(), 'random');
    assert.equal(ctrl.propsToFormData('random').get('level'), '720');
  };
  await ctrl.startBot(720);
  assert.ok(submitted);
  assert.deepEqual(ctrl.store.ai(), storedBefore);
  assert.equal(ctrl.startingBot, false);
  assert.equal(ctrl.gameType, null);
});

test('skip challenges submit every custom choice even when the map level is locked', async () => {
  const root = {
    me: { username: 'custom-bot-test' },
    pools: [],
    redraw() {},
    leavePool() {},
    hasOngoingRealTimeGame: () => false,
  } as any;
  const ctrl = new SetupController(root);
  ctrl.aiStats = { levels: [] };
  mock.method(ctrl, 'loadAiStats', async () => {});
  ctrl.openModal('ai');
  const started: number[] = [];
  ctrl.submit = async () => {
    started.push(ctrl.aiLevel());
    assert.equal(ctrl.propsToFormData('random').get('level'), ctrl.aiLevel().toString());
  };

  await ctrl.startBot(98);
  assert.deepEqual(started, []);
  for (const level of aiCustomLevels) {
    ctrl.aiLevel(level);
    await ctrl.submit();
  }

  assert.deepEqual(started, aiCustomLevels);
});
