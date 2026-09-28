import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

test('fixed examples use native playback, starting frames, annotations and independent navigation', async () => {
  const boards = new Map<string, any>();
  mock.module(new URL('../src/index.ts', import.meta.url).href, {
    namedExports: {
      legalMoveDests: () => new Map(),
      uciMoveToCg: (move: string) => move,
      makeXiangqiGround: (element: HTMLElement, options: any) => {
        const id = element.id || element.closest<HTMLElement>('[data-example-id]')!.dataset.exampleId!;
        boards.set(id, options);
        return { set: (state: any) => boards.set(id, { ...boards.get(id), ...state }) };
      },
    },
  });
  const sounds: unknown[] = [];
  globalThis.site = {
    asset: { loadPieces: Promise.resolve() },
    sound: { move: (options: unknown) => sounds.push(options) },
  } as any;
  window.matchMedia = globalThis.matchMedia;
  globalThis.fetch = mock.fn(() => {
    throw new Error('Fixed examples must not fetch positions');
  });
  const examples = ['one', 'two'].map(id => ({
    id,
    initialPly: 1,
    annotations: { '1': 'The elbow horse.' },
    replay: {
      ruleset: 'unrestricted',
      states: [0, 1, 2].map(ply => ({
        fen: `${id}-${ply}`,
        ply,
        turn: 'red' as const,
        legalMoves: [],
        check: false,
        gameResult: '*',
      })),
      script: [
        { move: 'b0c2', english: 'H8+7', chinese: '马八进七' },
        { move: 'b9c7', english: 'h2+3', chinese: '马2进3' },
      ],
    },
  }));
  document.body.innerHTML =
    '<div id="map"></div>' +
    examples
      .map(
        ({ id }) =>
          `<div class="special-rules__example" data-example-id="${id}"><div class="cg-wrap"></div><div class="special-rules__moves"></div><div class="special-rules__controls"></div><div class="special-rules__notice"></div><p class="special-rules__status"></p><p class="special-rules__annotation"></p></div>`,
      )
      .join('');
  const shapes = [{ orig: 'c9' as const, brush: 'blue' }];
  const init = (await import('../src/xiangqi.specialRules.ts')).default;
  await init({ examples, animationDuration: 200, diagrams: [{ id: 'map', fen: 'empty', shapes }] });
  assert.equal(boards.get('map').viewOnly, true);
  assert.deepEqual(boards.get('map').drawable.autoShapes, shapes);
  assert.equal(boards.get('one').fen, 'one-1');
  assert.equal(boards.get('two').fen, 'two-1');
  assert.equal(sounds.length, 0);
  const first = document.querySelector<HTMLElement>('[data-example-id="one"]')!;
  const annotation = first.querySelector<HTMLElement>('.special-rules__annotation')!;
  assert.equal(annotation.textContent, 'The elbow horse.');
  first.querySelector<HTMLElement>('[data-move-ply="2"]')!.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(boards.get('one').fen, 'one-2');
  assert.equal(boards.get('two').fen, 'two-1');
  assert.equal(annotation.hidden, true);
  assert.equal(sounds.length, 1);
  first.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(boards.get('one').fen, 'one-0');
  assert.equal(boards.get('one').lastMove, undefined);
  assert.equal(boards.get('two').fen, 'two-1');
});
