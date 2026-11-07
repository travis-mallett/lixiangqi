import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Rules } from 'threeKingdoms';

import { JIEQI_START_FEN } from 'lib/game/jieqi';
import { MANCHU_START_FEN } from 'lib/game/manchu';
import { MINI_XIANGQI_START_FEN } from 'lib/game/minixiangqi';

import EditorCtrl from '../src/ctrl';
import { editorFen } from '../src/fen';
import type { Config, EditorVariant } from '../src/interfaces';
import { kingdomPosition } from '../src/position';
import EditorView from '../src/view';

const rules: Rules = (
  await import(new URL('../../../public/three-kingdoms-engine/main.js', import.meta.url).href)
).ThreeKingdoms;
const config = (variant: EditorVariant, startFen: string): Config => ({
  baseUrl: '/editor',
  variant,
  startFen,
  animation: { duration: 0 },
  embed: true,
});

test('rectangular editor codecs preserve variant identity, concealed pieces and metadata', () => {
  for (const [variant, fen] of [
    ['jieqi', JIEQI_START_FEN],
    ['minixiangqi', MINI_XIANGQI_START_FEN],
    ['manchu', MANCHU_START_FEN],
  ] as const) {
    assert.equal(editorFen(fen, variant), fen);
    assert.equal(editorFen(fen, 'xiangqi'), undefined);
    const ctrl = new EditorCtrl(config(variant, fen), () => {});
    ctrl.clearBoard();
    assert.equal(ctrl.position().pieces.size, 0);
    const url = new URL(ctrl.url(), 'https://example.test');
    assert.equal(url.searchParams.get('variant'), variant);
    assert.equal(url.searchParams.get('fen'), ctrl.getFen());
    ctrl.startPosition();
    assert.equal(ctrl.getFen(), fen);
    ctrl.destroy();
  }
  const withoutBanner = MANCHU_START_FEN.replace('m1bakab1r', '2bakab1r');
  assert.equal(editorFen(withoutBanner, 'manchu'), withoutBanner);
  assert.equal(editorFen(MINI_XIANGQI_START_FEN.replace('RCNKNCR', 'RANKNCR'), 'minixiangqi'), undefined);
});

test('variant palettes use the actual roles and geometry', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [variant, fen, red, black] of [
    ['minixiangqi', MINI_XIANGQI_START_FEN, 5, 5],
    ['manchu', MANCHU_START_FEN, 7, 6],
    ['jieqi', JIEQI_START_FEN, 8, 8],
  ] as const) {
    const root = document.createElement('div');
    document.body.append(root);
    const ctrl = new EditorCtrl(config(variant, fen), () => view.update());
    const view = new EditorView(root, ctrl);
    view.mount();
    assert.equal(root.querySelectorAll('.spare-red [data-army]').length, red);
    assert.equal(root.querySelectorAll('.spare-black [data-army]').length, black);
    assert.equal(
      ctrl.ground!.getDefinition().geometry.id,
      variant === 'minixiangqi' ? 'minixiangqi-7x7' : 'xiangqi-9x10',
    );
    view.destroy();
    root.remove();
  }
});

test('Three Kingdoms diagrams can be incomplete, shared, validated and restored', async () => {
  const adapter = kingdomPosition(rules);
  const ctrl = new EditorCtrl(config('threeKingdoms', rules.initial()), () => {}, adapter);
  assert.equal(ctrl.position().pieces.size, 48);
  const valid = await adapter.validate(ctrl.getFen(), new AbortController().signal);
  assert.equal(valid.playable, true);
  ctrl.state.legalFen = valid.fen;
  assert.ok(ctrl.analysisUrl()!.startsWith('/analysis/threeKingdoms?position='));
  assert.equal(ctrl.canStartGame(), false);
  ctrl.clearBoard();
  assert.equal(ctrl.position().pieces.size, 0);
  assert.ok(adapter.read(ctrl.getFen()));
  await assert.rejects(adapter.validate(ctrl.getFen(), new AbortController().signal));
  ctrl.startPosition();
  ctrl.setOrientation('green');
  const url = new URL(ctrl.url(), 'https://example.test');
  assert.equal(url.searchParams.get('color'), 'green');
  assert.equal(url.searchParams.get('fen'), rules.initial());
  assert.equal(ctrl.setFen('TK1;bogus'), false);
  ctrl.destroy();
});

test('Three Kingdoms ownership and side selection survive editing, sharing and a second edit', async () => {
  const adapter = kingdomPosition(rules);
  const ctrl = new EditorCtrl(config('threeKingdoms', rules.initial()), () => {}, adapter);
  ctrl.setOwner('green', 'red');
  assert.deepEqual(ctrl.activeColors(), ['black', 'red']);
  assert.equal(ctrl.position().pieces.get('wu:4:0')?.face, 'up');
  const general = ctrl.position().pieces.get('wu:4:0');
  assert.ok(general?.face === 'up' && general.inactive && general.controller === 'red');
  const encoded = ctrl.getFen();
  ctrl.setTurn('green');
  assert.equal(ctrl.getFen(), encoded);
  assert.equal(ctrl.setFen(encoded), true);
  ctrl.setTurn('black');
  assert.equal(rules.diagram(ctrl.getFen()).turn, 'black');
  assert.deepEqual(ctrl.owners(), ['black', 'red', 'red']);
  await adapter.validate(ctrl.getFen(), new AbortController().signal);
  ctrl.setOwner('green', null);
  assert.equal(ctrl.position().pieces.size, 32);
  ctrl.destroy();
});

test('Three Kingdoms imported history survives presentation changes and resets only when editing', () => {
  const moved = rules.play(rules.initial(), rules.inspect(rules.initial()).moves[0]);
  const ctrl = new EditorCtrl(
    { ...config('threeKingdoms', rules.initial()), fen: moved },
    () => {},
    kingdomPosition(rules),
  );
  ctrl.flip();
  assert.equal(ctrl.getFen(), moved);
  ctrl.changed();
  assert.equal(rules.inspect(ctrl.getFen()).lastMove, null);
  ctrl.destroy();
});
