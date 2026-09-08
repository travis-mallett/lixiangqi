import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const indexUrl = new URL('../src/index.ts', import.meta.url).href;
const specialRulesUrl = new URL('../src/xiangqi.specialRules.ts', import.meta.url).href;

test('special rules initializes independent authoritative widgets', async () => {
  const examples = [
    { id: 'single-chariot-check', endpoint: '/special/single/', length: 13 },
    { id: 'two-piece-check', endpoint: '/special/two/', length: 25 },
    { id: 'three-piece-check', endpoint: '/special/three/', length: 37 },
  ];
  const requests: Array<{ id: string; url: string; ply: number }> = [];
  const boardState = new Map<string, string>();
  const failTwoAt = 5;
  mock.module(indexUrl, {
    namedExports: {
      legalMoveDests: () => new Map(),
      makeXiangqiGround: (element: HTMLElement) => ({
        set: (state: { fen: string }) =>
          boardState.set(element.closest<HTMLElement>('[data-example-id]')!.dataset.exampleId!, state.fen),
      }),
      uciMoveToCg: (move: string) => move,
    },
  });
  const scriptFor = (length: number) =>
    Array.from({ length }, (_, index) => ({
      move: `a${index + 1}a${index + 1}`,
      english: `M${index + 1}`,
      chinese: `中${index + 1}`,
    }));
  const response = (id: string, ply: number) => {
    const example = examples.find(candidate => candidate.id === id)!;
    const acceptedPly = Math.min(ply, example.length - 1);
    return {
      ruleset: 'tiantian-v1',
      acceptedPly,
      state: {
        fen: `${id}-server-${acceptedPly}`,
        ply: acceptedPly,
        turn: 'red',
        legalMoves: [],
        check: false,
        gameResult: '*',
        variation: ply >= example.length - 1 ? 'perpetual-check' : null,
      },
      lastMove: undefined,
      rejected: ply === example.length ? { ply, move: `a${ply}a${ply}`, error: `${id} rejected` } : null,
      script: scriptFor(example.length),
    };
  };
  globalThis.site = { asset: { loadPieces: Promise.resolve() }, sound: { move: () => {} } } as any;
  window.matchMedia = globalThis.matchMedia;
  globalThis.fetch = mock.fn(async (url: string) => {
    const match = examples.find(example => url.startsWith(example.endpoint));
    assert.ok(match, `unexpected endpoint: ${url}`);
    const ply = Number(url.slice(match.endpoint.length));
    requests.push({ id: match.id, url, ply });
    if (match.id === 'two-piece-check' && ply === failTwoAt) throw new Error('offline');
    return { ok: true, json: async () => response(match.id, ply) } as Response;
  }) as any;
  const widget = (id: string) =>
    `<div class="special-rules__example" data-example-id="${id}"><div class="cg-wrap"></div><div class="special-rules__moves" aria-label="Example moves"></div><div class="special-rules__controls"></div><div class="special-rules__notice"></div><p class="special-rules__status"></p></div>`;
  document.body.innerHTML = `<main class="special-rules">${examples.map(example => widget(example.id)).join('')}</main>`;
  const initExamples = (await import(specialRulesUrl)).default;
  await initExamples({
    examples: examples.map(({ id, endpoint }) => ({ id, endpoint })),
    animationDuration: 0,
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  const roots = new Map(
    [...document.querySelectorAll<HTMLElement>('.special-rules__example')].map(root => [
      root.dataset.exampleId!,
      root,
    ]),
  );
  // Give one bounded move panel measurable geometry so replay autoscroll is
  // exercised in jsdom (which otherwise reports zero-sized elements).
  const measuredMoves = roots
    .get('single-chariot-check')!
    .querySelector<HTMLElement>('.special-rules__moves')!;
  Object.defineProperties(measuredMoves, {
    clientWidth: { configurable: true, value: 100 },
    clientHeight: { configurable: true, value: 100 },
  });
  measuredMoves.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 100 }) as DOMRect;
  measuredMoves.querySelectorAll<HTMLElement>('[data-move-ply]').forEach(move => {
    move.getBoundingClientRect = () =>
      ({
        top: move.classList.contains('active') || move.classList.contains('rejected') ? 150 : 0,
        bottom: move.classList.contains('active') || move.classList.contains('rejected') ? 170 : 20,
        left: move.classList.contains('active') || move.classList.contains('rejected') ? 150 : 0,
        right: move.classList.contains('active') || move.classList.contains('rejected') ? 170 : 20,
      }) as DOMRect;
  });
  assert.equal(measuredMoves.scrollTop, 0);
  assert.equal(measuredMoves.scrollLeft, 0);
  assert.deepEqual(
    requests.slice(0, 3),
    examples.map(({ id, endpoint }) => ({ id, url: `${endpoint}0`, ply: 0 })),
  );
  const snapshotOthers = (except: string) =>
    new Map(
      examples
        .filter(example => example.id !== except)
        .map(example => [
          example.id,
          { html: roots.get(example.id)!.innerHTML, fen: boardState.get(example.id) },
        ]),
    );
  const assertUnchanged = (snapshot: Map<string, { html: string; fen: string | undefined }>) => {
    for (const [id, state] of snapshot) {
      assert.equal(roots.get(id)!.innerHTML, state.html, `${id} DOM changed`);
      assert.equal(boardState.get(id), state.fen, `${id} board changed`);
    }
  };
  for (const example of examples) {
    const root = roots.get(example.id)!;
    const moves = root.querySelector<HTMLElement>('.special-rules__moves')!;
    assert.equal(moves.querySelectorAll('move').length, example.length);
    assert.equal(root.querySelector('.special-rules__diagnostics'), null);
  }
  const single = roots.get('single-chariot-check')!;
  const controls = single.querySelector<HTMLElement>('.special-rules__controls')!;
  assert.equal(controls.classList.contains('analyse-controls'), true);
  assert.equal(controls.classList.contains('replay-controls'), true);
  assert.deepEqual(
    [...controls.querySelectorAll<HTMLElement>('.jumps button')].map(button => button.dataset.act),
    ['first', 'prev', 'next', 'last'],
  );
  single.querySelector<HTMLElement>('[data-move-ply="5"]')!.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(measuredMoves.scrollTop, 70);
  assert.equal(measuredMoves.scrollLeft, 70);
  const ids = [...document.querySelectorAll<HTMLElement>('[id]')].map(element => element.id);
  assert.equal(new Set(ids).size, ids.length);

  const beforeTwoFailure = snapshotOthers('two-piece-check');
  roots.get('two-piece-check')!.querySelector<HTMLElement>('[data-move-ply="5"]')!.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(
    roots.get('two-piece-check')!.querySelector<HTMLElement>('.special-rules__status')!.textContent,
    'offline',
  );
  assertUnchanged(beforeTwoFailure);
  const beforeThreeMove = snapshotOthers('three-piece-check');
  roots.get('three-piece-check')!.querySelector<HTMLElement>('[data-move-ply="5"]')!.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(boardState.get('three-piece-check'), 'three-piece-check-server-5');
  assert.equal(boardState.get('two-piece-check'), 'two-piece-check-server-0');
  assertUnchanged(beforeThreeMove);

  for (const example of examples) {
    const root = roots.get(example.id)!;
    const moves = root.querySelector<HTMLElement>('.special-rules__moves')!;
    const beforeFinal = snapshotOthers(example.id);
    moves.querySelector<HTMLElement>(`[data-move-ply="${example.length}"]`)!.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(boardState.get(example.id), `${example.id}-server-${example.length - 1}`);
    assert.equal(
      moves.querySelector<HTMLElement>(`[data-move-ply="${example.length}"]`)!.classList.contains('rejected'),
      true,
    );
    assert.match(
      root.querySelector<HTMLElement>('.special-rules__notice')!.textContent,
      /rejected|limit|禁止|规则/,
    );
    assert.match(root.querySelector<HTMLElement>('.special-rules__status')!.textContent, /rejected|拒绝/);
    assert.equal(root.querySelector('.special-rules__diagnostics'), null);
    assertUnchanged(beforeFinal);
    const previous = root.querySelector<HTMLButtonElement>('[data-act="prev"]')!;
    window.HTMLElement.prototype.releasePointerCapture = () => {};
    previous.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    previous.dispatchEvent(new window.Event('pointerup', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(requests.at(-1)?.url, `${example.endpoint}${example.length - 1}`);
    assert.equal(
      moves.querySelector<HTMLElement>(`[data-move-ply="${example.length}"]`)!.classList.contains('rejected'),
      false,
    );
    assert.equal(root.querySelector('.special-rules__diagnostics'), null);
    assert.match(root.querySelector<HTMLElement>('.special-rules__notice')!.textContent, /limit|规则/);
    const moveEarlier = moves.querySelector<HTMLElement>(`[data-move-ply="${example.length - 3}"]`)!;
    moveEarlier.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(requests.at(-1)?.url, `${example.endpoint}${example.length - 3}`);
    assert.equal(root.querySelector<HTMLElement>('.special-rules__notice')!.textContent, '');
    assertUnchanged(beforeFinal);
  }
  assert.equal(boardState.get('single-chariot-check'), 'single-chariot-check-server-10');
  assert.equal(boardState.get('two-piece-check'), 'two-piece-check-server-22');
  assert.equal(boardState.get('three-piece-check'), 'three-piece-check-server-34');
});
