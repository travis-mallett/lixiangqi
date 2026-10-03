import assert from 'node:assert/strict';
import test from 'node:test';
import { h, init } from 'snabbdom';

import type AnalyseCtrl from '../src/ctrl';
import { renderXiangqiEngine, renderXiangqiGauge } from '../src/view/xiangqiEngine';

test('shared study engine renders PVs, obeys concealment and permissions, and remounts after disposal', () => {
  const previous = window.matchMedia;
  const lifetimes: AbortSignal[] = [];
  window.matchMedia = () =>
    ({
      matches: false,
      addEventListener: (_event, _listener, options) => {
        lifetimes.push((options as AddEventListenerOptions).signal!);
      },
    }) as MediaQueryList;
  const evaluation = {
    cp: -125,
    depth: 15,
    nodes: 2000,
    millis: 1000,
    pvs: [
      { cp: -125, moves: ['a4a5'] },
      { mate: 3, moves: ['c4c5'] },
    ],
  };
  let allowed = true;
  let hidden = false;
  let enabled = true;
  let chapter = 'first';
  let settingsOpen = false;
  let searchTime = 8000;
  let restarts = 0;
  let selectedEngine = '';
  const engine = { id: 'pikafish', name: 'Pikafish', maxHash: 256 };
  const ctrl = {
    node: { fen: 'root w - - 0 1', ceval: evaluation },
    path: '',
    tree: {
      root: { fen: 'root w - - 0 1' },
      positionAt: () => ({ initialFen: 'root w - - 0 1', moves: [], ruleset: 'unrestricted-v1' }),
    },
    getOrientation: () => 'red',
    playUciList: () => undefined,
    cevalEnabled: () => enabled,
    isCevalAllowed: () => allowed,
    allowedEval: () => enabled && evaluation,
    threatMode: () => false,
    clearCeval: () => restarts++,
    study: { hideMoves: () => hidden, currentChapter: () => ({ id: chapter }) },
    ceval: {
      search: { multiPv: 2, by: { movetime: 8000 } },
      engines: {
        active: () => engine,
        supporting: () => [engine, { id: 'external', name: 'Worker' }],
        external: { id: 'external' },
      },
      opts: { variant: { key: 'xiangqi' }, redraw: () => undefined },
      selectEngine: (id: string) => {
        selectedEngine = id;
      },
      showEnginePrefs: Object.assign(() => settingsOpen, {
        toggle: () => {
          settingsOpen = !settingsOpen;
        },
      }),
      info: () => ({ threads: 1, hashSize: 16 }),
      storedMovetime: (value?: number) => {
        if (value !== undefined) searchTime = value;
        return searchTime;
      },
      storedPv: () => 2,
      maxThreads: 2,
      isComputing: true,
    },
  } as unknown as AnalyseCtrl;
  const patch = init([]);
  const mount = document.createElement('div');
  document.body.append(mount);
  let vnode = patch(mount, h('div', [renderXiangqiGauge(ctrl), ...renderXiangqiEngine(ctrl)]));
  const redraw = () => {
    vnode = patch(vnode, h('div', [renderXiangqiGauge(ctrl), ...renderXiangqiEngine(ctrl)]));
  };
  ctrl.redraw = redraw;
  try {
    assert.equal(document.querySelectorAll('.xiangqi-engine__lines > .pv:not(.placeholder)').length, 2);
    assert.equal(document.querySelector('.xiangqi-eval__score')!.textContent, '−1.25');
    assert.equal(document.querySelectorAll('.xiangqi-eval').length, 1);
    const gear = document.querySelector<HTMLButtonElement>('.xiangqi-engine__summary button')!;
    gear.click();
    const settings = document.querySelector<HTMLElement>('.xiangqi-engine-settings')!;
    assert.equal(settings.hidden, false);
    const provider = settings.querySelector<HTMLSelectElement>('#select-engine')!;
    assert.equal(provider.options.length, 2);
    assert.ok(settings.querySelector('button[title="Delete external engine"]'));
    assert.ok(settings.querySelector('button[title="Engine information"]'));
    provider.value = 'external';
    provider.dispatchEvent(new window.Event('change'));
    assert.equal(selectedEngine, 'external');
    const search = settings.querySelector<HTMLInputElement>('input[data-setting="search-time"]')!;
    search.value = '9';
    search.dispatchEvent(new window.Event('change'));
    assert.equal(searchTime, Infinity);
    assert.equal(restarts, 1);
    gear.click();
    assert.equal(settings.hidden, true);
    gear.click();
    assert.equal(settings.hidden, false);
    assert.equal(settings.querySelector('#select-engine'), provider);
    gear.click();
    hidden = true;
    redraw();
    assert.equal(document.querySelectorAll('.xiangqi-engine__lines > .pv:not(.placeholder)').length, 0);
    hidden = false;
    allowed = false;
    redraw();
    assert.equal(document.querySelector('.xiangqi-eval__score')!.textContent, '+0.00');
    assert.equal(document.querySelectorAll('.xiangqi-engine__lines > .pv:not(.placeholder)').length, 0);
    allowed = true;
    enabled = false;
    chapter = 'second';
    redraw();
    assert.equal(document.querySelector('.xiangqi-eval__score')!.textContent, '+0.00');
    vnode = patch(vnode, h('div'));
    assert.equal(lifetimes[0].aborted, true);
    enabled = true;
    redraw();
    assert.equal(document.querySelectorAll('.xiangqi-engine__lines > .pv:not(.placeholder)').length, 2);
    assert.equal(lifetimes.length, 2);
  } finally {
    patch(vnode, h('div'));
    window.matchMedia = previous;
    document.body.replaceChildren();
  }
});
