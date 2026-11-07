import assert from 'node:assert/strict';
import { test } from 'node:test';
import { init, attributesModule, propsModule, eventListenersModule, type VNode } from 'snabbdom';

import { MANCHU_START_FEN } from 'lib/game/manchu';
import { MINI_XIANGQI_START_FEN } from 'lib/game/minixiangqi';

import SetupController from '../src/setupCtrl';
import { rulesetPicker } from '../src/view/setup/components/rulesetPicker';
import { variantPicker } from '../src/view/setup/components/variantPicker';

function controller() {
  const root = { leavePool() {}, redraw() {}, pools: [] } as any;
  const ctrl = new SetupController(root);
  root.setupCtrl = ctrl;
  ctrl.loadAiStats = async () => {};
  return { ctrl, root };
}

for (const [variant, fen] of [
  ['minixiangqi', MINI_XIANGQI_START_FEN],
  ['manchu', MANCHU_START_FEN],
]) {
  test(`${variant} editor handoff sends the native variant and bounds its computer level`, () => {
    const { ctrl } = controller();
    ctrl.store.ai({ ...ctrl.store.ai(), aiLevel: 720 });
    ctrl.openModal('ai', { variant: 'fromPosition', fen });
    assert.equal(ctrl.usesVariantLevels(), true);
    assert.equal(ctrl.aiLevel(), 10);
    const data = ctrl.propsToFormData('white');
    assert.equal(data.get('variant'), '3');
    assert.equal(data.get('gameVariant'), variant);
    assert.equal(data.get('fen'), fen);
    assert.equal(data.has('ruleset'), false);
  });
}

for (const type of ['ai', 'hook', 'friend'] as const) {
  test(`${type} setup ignores a previously saved Jieqi variant`, () => {
    const { ctrl } = controller();
    ctrl.store[type]({ ...ctrl.store[type](), variant: 'jieqi', color: 'black' });
    ctrl.openModal(type);
    assert.equal(ctrl.variant(), 'standard');
    if (type === 'ai') assert.equal(ctrl.color(), 'white');
    ctrl.openModal(type, { variant: 'jieqi' });
    assert.equal(ctrl.variant(), 'jieqi');
    ctrl.variant('standard');
    assert.equal(ctrl.valid(), true);
    ctrl.openModal(type);
    assert.equal(ctrl.variant(), 'standard');
  });
}

test('explicit position and color choices survive setup initialization', () => {
  const { ctrl } = controller();
  ctrl.openModal('ai', { variant: 'fromPosition', fen: 'custom', color: 'black' });
  assert.equal(ctrl.variant(), 'fromPosition');
  assert.equal(ctrl.fen(), 'custom');
  assert.equal(ctrl.color(), 'black');
});

test('switching from Jieqi loads Xiangqi bot performance and uses a supported difficulty', () => {
  const { ctrl } = controller();
  let requests = 0;
  ctrl.loadAiStats = async () => {
    requests++;
    ctrl.aiStats = { levels: [] };
  };
  ctrl.openModal('ai', { variant: 'jieqi' });
  ctrl.aiLevel(10);
  assert.equal(requests, 0);
  ctrl.variant('standard');
  assert.equal(requests, 1);
  assert.equal(ctrl.aiLevel(), 9);
  ctrl.variant('jieqi');
  ctrl.variant('standard');
  assert.equal(requests, 1);
});

test('repetition rule selection stays mounted and usable across redraws', () => {
  const { ctrl, root } = controller();
  ctrl.openModal('ai');
  const patch = init([attributesModule, propsModule, eventListenersModule]);
  const mount = document.createElement('div');
  document.body.append(mount);
  let tree: VNode = patch(mount, rulesetPicker(root));
  root.redraw = () => {
    tree = patch(tree, rulesetPicker(root));
  };
  const select = (tree.elm as HTMLElement).querySelector('select')!;
  for (const value of ['unrestricted-v1', 'tiantian-v1', 'unrestricted-v1']) {
    select.value = value;
    select.dispatchEvent(new window.Event('change'));
    assert.equal(ctrl.ruleset, value);
    assert.equal((tree.elm as HTMLElement).querySelector('select'), select);
    assert.equal(select.value, value);
    assert.equal(select.hidden, false);
  }
  (tree.elm as HTMLElement).remove();
});

test('position setup displays its selected variant instead of silently showing Xiangqi', () => {
  const { ctrl } = controller();
  ctrl.openModal('friend', { variant: 'fromPosition', fen: 'custom' });
  const patch = init([attributesModule, propsModule, eventListenersModule]);
  const mount = document.createElement('div');
  document.body.append(mount);
  const tree = patch(mount, variantPicker(ctrl));
  assert.equal((tree.elm as HTMLElement).querySelector('select')!.value, 'fromPosition');
  (tree.elm as HTMLElement).remove();
});
