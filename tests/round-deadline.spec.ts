import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import type RoundController from '../ui/round/src/ctrl';

declare global {
  interface Window {
    roundFixture: RoundController;
    sentMoves: string[];
  }
}

const { build } = createRequire(resolve('ui/.build/package.json'))('esbuild');
let script: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import RoundController from './ui/round/src/ctrl';
        import { createRoundBoard } from './ui/round/src/board';
        import { statusOf, XIANGQI_START_FEN } from './ui/lib/src/game';
        const data = {
          game: { id: 'testgame', player: 'white', turns: 0, source: 'arena', variant: {key: 'standard'},
            speed: 'rapid', status: statusOf('started'), fen: XIANGQI_START_FEN },
          steps: [{ply: 0, fen: XIANGQI_START_FEN, san: ''}],
          player: {color: 'white'}, opponent: {color: 'black'},
          clock: {white: 300, black: 300, initial: 300, increment: 10, running: false},
          expiration: {idleMillis: 24000, millisToMove: 25000},
          possibleMoves: {b3: ['e3']}, pref: {animationDuration: 0}
        };
        window.sentMoves = [];
        const ctrl = window.roundFixture = new RoundController({
          data, noab: true,
          socketSend: (kind, payload) => { if (kind === 'move') window.sentMoves.push(payload.u); },
        }, () => {});
        ctrl.setBoard(createRoundBoard(document.querySelector('.cg-wrap'), ctrl));
      `,
    },
    conditions: ['source'],
    bundle: true,
    write: false,
    format: 'iife',
  });
  script = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.route('http://round.test/', route =>
    route.fulfill({
      contentType: 'text/html',
      body: `<link id="favicon"><div class="cg-wrap" style="width:400px;height:440px"></div>
      <script>
      window.$ = () => ({toggleClass(){}, hasClass(){return false}});
      window.$html = window.$trim = s => s[0];
      window.i18n = {site: {}, threeKingdoms: {}};
      window.site = {asset: {url: p => '/' + p}, sound: {move(){}, play(){}, say(){}, saySan(){}, speech(){return false}}, powertip: {}};
      </script>`,
    }),
  );
  await page.goto('http://round.test/');
  await page.addScriptTag({ content: script });
  await page.waitForFunction(() => !!window.roundFixture?.board);
});

const cannon = (page: Page) =>
  page.evaluate(() => {
    const piece = window.roundFixture.board.position().pieces.get('e3');
    return piece?.face === 'up' ? piece.role : null;
  });

test('a no-start result takes a sent cannon move off the board at the same ply', async ({ page }) => {
  await page.evaluate(() => {
    const board = window.roundFixture.board;
    board.select('b3');
    board.select('e3');
  });
  await page.clock.runFor(5);
  expect(await cannon(page)).toBe('cannon');
  expect(await page.evaluate(() => window.sentMoves)).toEqual(['b3e3']);
  await page.evaluate(() =>
    window.roundFixture.socket.receive('endData', {
      status: { id: 37, name: 'noStart' },
      winner: 'black',
      clock: { wc: 30000, bc: 30000 },
    }),
  );
  expect(await cannon(page)).toBeNull();
  expect(
    await page.evaluate(() => ({
      origin: window.roundFixture.board.position().pieces.has('b3'),
      ply: window.roundFixture.ply,
      canMove: window.roundFixture.canMove(),
      pending: window.roundFixture.transientMove?.current !== undefined,
    })),
  ).toEqual({ origin: true, ply: 0, canMove: false, pending: false });
});

test('a move awaiting confirmation cannot be sent after the opening deadline', async ({ page }) => {
  await page.evaluate(() => {
    const ctrl = window.roundFixture;
    ctrl.confirmMoveToggle(true);
    ctrl.pluginMove('b3', 'e3');
  });
  expect(await cannon(page)).toBe('cannon');
  await page.evaluate(() => {
    const ctrl = window.roundFixture;
    ctrl.data.expiration!.expiresAt = performance.now();
    ctrl.submitMove(true);
    ctrl.pluginMove('b3', 'e3');
  });
  expect(await page.evaluate(() => window.sentMoves)).toEqual([]);
  expect(await cannon(page)).toBeNull();
  expect(await page.evaluate(() => window.roundFixture.data.game.status.name)).toBe('started');
});

test('an accepted last-moment move stays on the final board', async ({ page }) => {
  await page.evaluate(() => {
    const ctrl = window.roundFixture;
    ctrl.data.expiration!.expiresAt = performance.now() + 1;
    ctrl.pluginMove('b3', 'e3');
    // The server accepted the cannon and Black subsequently missed their opening.
    ctrl.socket.receive('move', {
      ply: 1,
      uci: 'b3e3',
      san: 'C8=5',
      fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/4C2C1/9/RNBAKABNR b - - 1 1',
      clock: { white: 300, black: 300 },
    });
    ctrl.socket.receive('endData', { status: { id: 37, name: 'noStart' }, winner: 'white' });
  });
  expect(await page.evaluate(() => window.sentMoves)).toEqual(['b3e3']);
  expect(await cannon(page)).toBe('cannon');
  expect(await page.evaluate(() => window.roundFixture.ply)).toBe(1);
});

test('a bank flag blocks input and an authoritative time grant reopens it', async ({ page }) => {
  await page.evaluate(() => {
    const ctrl = window.roundFixture;
    ctrl.data.expiration = undefined;
    ctrl.clock!.setClock({ white: 0, black: 60, ticking: 'white' });
    ctrl.pluginMove('b3', 'e3');
    ctrl.updateClockInput();
  });
  expect(await page.evaluate(() => window.sentMoves)).toEqual([]);
  await page.evaluate(() => {
    const ctrl = window.roundFixture;
    ctrl.socket.receive('clockInc', { color: 'white', time: 1500 });
    ctrl.pluginMove('b3', 'e3');
  });
  expect(await page.evaluate(() => window.sentMoves)).toEqual(['b3e3']);
});
