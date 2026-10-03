import assert from 'node:assert/strict';
import { test } from 'node:test';

import ExplorerCtrl from '../src/explorerCtrl.ts';
import { openingReferences, renderOpeningReferences } from '../src/references.ts';

test('endgame queries retain rule history and expose rank-ten moves through keyboard interaction', async t => {
  const requests: any[] = [],
    played: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url, ...JSON.parse(init!.body as string) });
    return new Response(
      JSON.stringify({
        sourceUrl: 'https://www.chessdb.cn/cloudbook_info_en.html',
        providerRules: 'AXF',
        metric: 'dtm',
        tablebase: true,
        gameResult: '*',
        moves: [
          {
            move: 'i10i9',
            notation: 'R9+1',
            chineseNotation: '车九进一',
            note: 'W-M-0007',
            dtm: 7,
            outcome: 'win',
          },
        ],
      }),
    );
  });
  const element = document.createElement('div');
  const ctrl = new ExplorerCtrl(
    element,
    document.createElement('button'),
    move => played.push(move),
    () => {},
    '/native-explorer',
    { persistPreferences: false, initiallyEnabled: true },
  );
  ctrl.selectMode('tablebase');
  ctrl.setPosition({ fen: 'current', initialFen: 'root', moves: ['i1i2', 'i10i9'], ruleset: 'tiantian-v1' });
  await new Promise<void>(done => setImmediate(done));
  assert.deepEqual(requests, [
    {
      url: '/api/analysis/book',
      fen: 'current',
      initialFen: 'root',
      moves: ['i1i2', 'i10i9'],
      ruleset: 'tiantian-v1',
      metric: 'dtm',
      endgame: true,
    },
  ]);
  const row = element.querySelector<HTMLElement>('[data-uci="i10i9"]')!;
  assert.ok(row);
  row.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
  assert.deepEqual(played, ['i10i9']);
  assert.match(element.textContent, /DTM 7/);
  ctrl.destroy();
});

test('educational references retain source explanations and native replay links without rendering source HTML', async t => {
  const player = { name: 'Player' };
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          available: true,
          topGames: [
            {
              id: 'source:id',
              red: player,
              black: player,
              sourceUrl: 'https://example.org/native-record',
              metadata: {
                opening: 'Central cannon',
                remark: '<script>unsafe</script>',
                reference: 'Printed source, page 10',
              },
            },
          ],
          recentGames: [],
        }),
      ),
  );
  const references = await openingReferences('/native-explorer', {
    fen: 'position',
    initialFen: 'root',
    moves: ['h3e3'],
    ruleset: 'tiantian-v1',
  });
  const element = document.createElement('div');
  renderOpeningReferences(element, references);
  assert.match(element.textContent, /Printed source, page 10/);
  assert.equal(element.querySelector('script'), null);
  assert.equal(element.querySelector('a')!.getAttribute('href'), '/analysis?game=source%3Aid');
});
