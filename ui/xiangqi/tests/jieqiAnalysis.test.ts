import assert from 'node:assert/strict';
import test from 'node:test';

import { engineProgress } from 'lib/ceval/engineProgress';
import { JIEQI_START_FEN } from 'lib/game/jieqi';

import { analysisEngineConfig } from '../src/analysisEngineConfig';
import {
  createAnalysisSettings,
  createJieqiEngineSelection,
  createAnalysisEngineView,
  createAnalysisGauge,
  analysisSuggestionElements,
  updateAnalysisEngineIdentity,
} from '../src/analysisEngineView';
import { engineSettingsKey, loadEngineSettings } from '../src/analysisSettings';
import { AnalysisSuggestions } from '../src/analysisSuggestions';

test('Jieqi depth and line settings are bounded and independent of Xiangqi settings', () => {
  localStorage.clear();
  localStorage.setItem(engineSettingsKey('xiangqi'), JSON.stringify({ depth: 30, multiPv: 5 }));
  localStorage.setItem(engineSettingsKey('jieqi'), JSON.stringify({ depth: 99, multiPv: 2 }));
  const settings = loadEngineSettings('jieqi');
  assert.equal(settings.depth, 30);
  assert.equal(settings.multiPv, 2);
  assert.equal(loadEngineSettings().depth, 30);
  assert.deepEqual(analysisEngineConfig('jieqi').search(settings), { depth: 30 });
  assert.equal(analysisEngineConfig('jieqi').threads(settings), 1);
  localStorage.clear();
  assert.equal(loadEngineSettings('jieqi').multiPv, 1);
  assert.deepEqual(analysisEngineConfig('jieqi').search(loadEngineSettings('jieqi')), { depth: 20 });
});

test('node progress reflects search budget and explicit completion, not depth', () => {
  const progress = engineProgress(true, { state: 'computing' }, 2, 20, {
    searched: 125000,
    target: 250000,
    complete: false,
  });
  assert.equal(progress.percent, 50);
  assert.equal(
    engineProgress(true, { state: 'ready' }, 2, 20, { searched: 100, target: 250000, complete: true })
      .percent,
    100,
  );
  assert.equal(
    engineProgress(true, { state: 'ready' }, 2, 20, { searched: 125000, target: 250000, complete: false })
      .percent,
    50,
  );
});

test('Jieqi presents candidate notation in the chosen language and requests no reveal replay', async t => {
  window.matchMedia = globalThis.matchMedia;
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(String(url));
    return new Response(JSON.stringify({ b10c8: { notation: 'h2+3', chineseNotation: '马２进３' } }));
  });
  const engine = createAnalysisEngineView();
  const gauge = createAnalysisGauge();
  updateAnalysisEngineIdentity(engine, gauge, analysisEngineConfig('jieqi'));
  assert.match(engine.textContent, /AB-JChess/);
  const elements = analysisSuggestionElements(engine, gauge);
  const suggestions = new AnalysisSuggestions(
    JIEQI_START_FEN,
    () => 'red',
    () => 1,
    elements,
    () => 'chinese',
  );
  suggestions.setPosition(
    JIEQI_START_FEN,
    { initialFen: JIEQI_START_FEN, moves: [], ruleset: 'jieqi-v1' },
    () => {},
  );
  const result = {
    engine: 'PikaJieQi',
    depth: 2,
    nodes: 250000,
    nps: 100,
    timeMs: 100,
    score: {},
    lines: [{ multipv: 1, depth: 2, seldepth: 2, score: {}, pvMoves: ['b10c8'], wxfMoves: [] }],
  };
  suggestions.renderEngine(result, () => {}, true);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(elements.engineLines.querySelector('.pv-san')?.textContent, '马２进３');
  assert.deepEqual(requests, ['/api/analysis/move-labels']);
  suggestions.renderEngine(result, () => {}, true);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(requests.length, 1);
  suggestions.destroy();
});

test('Jieqi shows the shared line and depth sliders while hiding unsupported settings', () => {
  const engine = createAnalysisEngineView();
  const panel = createAnalysisSettings([
    { name: 'multipv', label: i18n.site.multipleLines, type: 'range', min: 1, max: 5, value: 1 },
    { name: 'depth', label: 'Search depth', type: 'range', min: 10, max: 30, value: 20 },
    { name: 'threads', label: i18n.site.threads, type: 'range', value: 1 },
  ]);
  engine.querySelector('.xiangqi-engine-settings')!.replaceWith(panel);
  updateAnalysisEngineIdentity(engine, createAnalysisGauge(), analysisEngineConfig('jieqi', 'pikajieqi'));
  for (const name of ['multipv', 'depth'])
    assert.equal(panel.querySelector(`[data-setting="${name}"]`)!.closest('label')!.hidden, false);
  assert.equal(panel.querySelector('[data-setting="threads"]')!.closest('label')!.hidden, true);
  assert.equal(
    panel.querySelector('[data-setting="multipv"]')!.closest('label')!.firstElementChild!.textContent,
    String(i18n.site.multipleLines),
  );
});

test('Jieqi always opens with AB-JChess and offers the other engines on demand', () => {
  localStorage.clear();
  assert.equal(loadEngineSettings('jieqi').jieqiEngine, 'abjchess');
  localStorage.setItem(engineSettingsKey('jieqi'), JSON.stringify({ jieqiEngine: 'pikajieqi' }));
  assert.equal(loadEngineSettings('jieqi').jieqiEngine, 'abjchess');
  localStorage.setItem(engineSettingsKey('jieqi'), JSON.stringify({ jieqiEngine: 'invalid' }));
  assert.equal(loadEngineSettings('jieqi').jieqiEngine, 'abjchess');
  const choices: string[] = [];
  const label = createJieqiEngineSelection(id => choices.push(id));
  const select = label.querySelector('select')!;
  assert.deepEqual(
    [...select.options].map(option => option.value),
    ['abjchess', 'jqe', 'pikajieqi'],
  );
  select.value = 'pikajieqi';
  select.dispatchEvent(new window.Event('change'));
  assert.deepEqual(choices, ['pikajieqi']);
  assert.ok(analysisEngineConfig('jieqi').hiddenSettings.includes('multipv'));
  assert.ok(!analysisEngineConfig('jieqi', 'pikajieqi').hiddenSettings.includes('multipv'));
  localStorage.clear();
});
