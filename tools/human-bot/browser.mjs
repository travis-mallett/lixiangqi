import { chromium, firefox, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../../ui/humanBot/dist/', import.meta.url));
const engineRoot = fileURLToPath(new URL('../../public/pikafish-web/', import.meta.url));
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname !== '/unisolated') {
      response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    }
    if (pathname === '/' || pathname === '/unisolated') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><meta charset="utf-8"><title>Human bot runtime test</title>');
      return;
    }
    const base = pathname.startsWith('/pikafish-web/') ? engineRoot : root;
    const relative = base === engineRoot ? pathname.slice('/pikafish-web'.length) : pathname;
    const path = resolve(base, `.${decodeURIComponent(relative)}`);
    if (!path.startsWith(resolve(base) + sep)) throw new Error('Invalid asset path');
    const bytes = await readFile(path);
    response.writeHead(200, {
      'Content-Type': pathname.endsWith('.js')
        ? 'text/javascript'
        : pathname.endsWith('.wasm')
          ? 'application/wasm'
          : 'application/octet-stream',
      'Cache-Control': new URL(request.url, 'http://localhost').searchParams.has('v')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    });
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const systemChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browserName = process.env.BROWSER ?? 'chromium';
const engine = { chromium, firefox, webkit }[browserName];
let browser;
const results = [];
try {
  if (!engine) throw new Error(`Unsupported browser: ${browserName}`);
  browser = await engine.launch({
    headless: true,
    executablePath:
      browserName === 'chromium'
        ? (process.env.CHROMIUM_EXECUTABLE ??
          (process.platform === 'win32' && existsSync(systemChrome) ? systemChrome : undefined))
        : undefined,
  });
  for (const [width, rate] of [
    [1440, 1],
    [768, 2],
    [390, 4],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      isMobile: browserName !== 'firefox' && width < 500,
      deviceScaleFactor: width < 500 ? 3 : 1,
    });
    const page = await context.newPage(),
      requests = [];
    context.on('request', request => requests.push(request.url()));
    if (browserName === 'chromium') {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    }
    await page.goto(`http://127.0.0.1:${address.port}`);
    const result = await page.evaluate(async () => {
      const core = await import('/index.js'),
        xiangqi = await import('/xiangqi.js');
      const client = new core.BotWorkerClient(new Worker('/worker.js', { type: 'module' }));
      let beats = 0;
      const heartbeat = setInterval(() => beats++, 5);
      const begin = performance.now();
      try {
        const initial = await client.call(
          {
            id: 'init',
            kind: 'init',
            game: 'browser',
            profile: xiangqi.xiangqiProfileSpec('advanced', 'browser'),
          },
          { timeoutMs: 60000 },
        );
        const startupMs = performance.now() - begin,
          capturedAt = Date.now();
        const snapshot = { initialFen: xiangqi.START_FEN, ruleset: 'tiantian-v1', moves: ['h3e3'] };
        const command = {
          id: 'decision',
          kind: 'decide',
          snapshot,
          player: 'black',
          now: capturedAt,
          clock: {
            capturedAt,
            remainingMs: 900000,
            referenceMs: 900000,
            incrementMs: 0,
            delayMs: 0,
            transportMs: 30,
            deadline: capturedAt + 900000,
          },
        };
        const result = await client.call(command),
          repeated = await client.call(command);
        if (JSON.stringify(result.pending) !== JSON.stringify(repeated.pending))
          throw new Error('Retry changed the pending decision');
        const saved = await client.call({ id: 'snapshot', kind: 'snapshot' });
        const before = saved.state.revision;
        const move = result.pending.action.move;
        if (move === 'b8b1') throw new Error('Repeated the bad opening cannon exchange');
        const accepted = await client.call({
          id: 'accept',
          kind: 'accept',
          token: result.pending.token,
          before: snapshot,
          after: { ...snapshot, moves: [...snapshot.moves, move] },
          acceptedAt: result.pending.submitAt,
        });
        if (accepted.revision !== before + 1) throw new Error('Worker did not commit exactly once');
        client.close();
        const restored = new core.BotWorkerClient(new Worker('/worker.js', { type: 'module' }));
        try {
          await restored.call(
            {
              id: 'restore',
              kind: 'init',
              game: 'browser',
              profile: xiangqi.xiangqiProfileSpec('advanced', 'browser'),
              saved,
            },
            { timeoutMs: 60000 },
          );
          const recovered = await restored.call(command);
          if (JSON.stringify(recovered.pending) !== JSON.stringify(result.pending))
            throw new Error('Crash recovery changed the decision');
          await restored.call({ id: 'cancel-recovered', kind: 'cancel', token: recovered.pending.token });
          const { XiangqiRules } = await import('/rules/main.js');
          const rules = new xiangqi.XiangqiAdapter(XiangqiRules);
          const threat = { ...snapshot, moves: ['h3e3', 'a7a6', 'e3e7', 'b8g8', 'b3b6'] };
          const defense = await restored.call({ ...command, id: 'mate-defense', snapshot: threat });
          const after = rules.play(rules.restore(threat), defense.pending.action.move)[0].position;
          if (
            after.observation.moves.some(
              reply => rules.play(after, reply.action)[0].position.observation.terminal?.red === 1,
            )
          )
            throw new Error('Bot permitted the reported mate in one');
        } finally {
          restored.close();
        }
        const cancellable = new core.BotWorkerClient(new Worker('/worker.js', { type: 'module' }));
        const stressProfile = xiangqi.xiangqiProfileSpec('advanced', 'stress');
        Object.assign(stressProfile.controls, {
          C01: 1,
          C02: 1,
          C03: 1,
          C04: 1,
          C05: 1,
          A03: 1,
          T02: 1,
          X01: 0,
        });
        await cancellable.call(
          {
            id: 'cancel-init',
            kind: 'init',
            game: 'browser',
            profile: stressProfile,
          },
          { timeoutMs: 60000 },
        );
        const stressAt = Date.now();
        const stress = await cancellable.call({
          ...command,
          id: 'maximum-capacity',
          now: stressAt,
          clock: {
            ...command.clock,
            capturedAt: stressAt,
            remainingMs: 3600000,
            referenceMs: 3600000,
            deadline: stressAt + 3600000,
          },
        });
        await cancellable.call({ id: 'cancel-stress', kind: 'cancel', token: stress.pending.token });
        const controller = new AbortController();
        const cancelled = cancellable.call(
          { ...command, id: 'cancel-decision' },
          { signal: controller.signal },
        );
        controller.abort();
        let rejected = false;
        try {
          await cancelled;
        } catch {
          rejected = true;
        }
        if (!rejected) throw new Error('Cancellation did not reject');
        return {
          startupMs,
          computeMs: result.computeMs,
          intendedMs: result.pending.trace.intendedMs,
          action: result.pending.action,
          mainThreadHeartbeats: beats,
          initializedRevision: initial.state.revision,
          runtime: initial.runtime,
          serializedStateBytes: JSON.stringify(saved).length,
          maximumCapacity: {
            computeMs: stress.computeMs,
            units: stress.pending.trace.units,
            candidates: stress.pending.trace.candidates.length,
            maxDepth: Math.max(0, ...stress.pending.trace.candidates.map(c => c.depth)),
            serializedPendingBytes: JSON.stringify(stress.pending).length,
          },
          search: result.pending.trace.engine,
          sharedArrayBufferRequired: true,
          crossOriginIsolated: globalThis.crossOriginIsolated,
        };
      } finally {
        clearInterval(heartbeat);
        client.close();
      }
    });
    assert(result.mainThreadHeartbeats > 0);
    assert.equal(result.crossOriginIsolated, true);
    assert(requests.some(url => url.includes('pikafish.nnue')));
    assert(result.runtime.wasmHeapBytes < 384 * 1024 * 1024);
    assert(result.computeMs < 4000);
    assert(result.intendedMs < 12000);
    results.push({ viewportWidth: width, pageCpuSlowdown: browserName === 'chromium' ? rate : 1, ...result });
    await context.close();
  }
  const unisolated = await browser.newPage();
  await unisolated.goto(`http://127.0.0.1:${address.port}/unisolated`);
  const missingIsolation = await unisolated.evaluate(async () => {
    const core = await import('/index.js'),
      xiangqi = await import('/xiangqi.js');
    const client = new core.BotWorkerClient(new Worker('/worker.js', { type: 'module' }));
    try {
      await client.call({
        id: 'isolation',
        kind: 'init',
        game: 'isolation',
        profile: xiangqi.xiangqiProfileSpec(),
      });
    } catch (error) {
      return String(error);
    } finally {
      client.close();
    }
    return '';
  });
  assert.match(missingIsolation, /cross-origin isolation/);
  await unisolated.close();
  const files = {};
  for (const file of ['index.js', 'xiangqi.js', 'worker.js', 'rules/main.js']) {
    const bytes = await readFile(resolve(root, file));
    files[file] = { bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
  }
  const output = {
    environment: `Headless ${browserName} on this host; page CPU throttling does not establish worker throughput on physical mobile hardware`,
    files,
    results,
    missingIsolation,
  };
  const out = process.argv[2] ?? '.tools/human-bot-browser.json';
  await writeFile(out, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
