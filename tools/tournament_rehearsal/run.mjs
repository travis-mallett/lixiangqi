import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { afterMove, clickMove, initialPlacement, readBoard } from './board.mjs';
import { createTournament, joinTournament, openPlayer, register } from './browser.mjs';
import { Engine } from './engine.mjs';
import { verifyScores } from './scores.mjs';

export function validateConfig(config, allowLive) {
  const url = new URL(config.baseUrl);
  const local =
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost');
  if (!local && !allowLive) throw new Error('Non-local runs require --allow-live explicitly');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('baseUrl must be an HTTP(S) origin');
  if (!local && url.protocol !== 'https:') throw new Error('Live credentials require HTTPS');
  if (!config.emailTemplate?.includes('{username}'))
    throw new Error('emailTemplate must contain {username} and produce ten distinct deliverable addresses');
  if (!config.enginePath) throw new Error('enginePath is required');
  if (config.headless)
    throw new Error('Use visible browsers: headless Chromium can receive a crawler/spectator view');
  return { ...config, local, baseUrl: url.origin, enginePath: resolve(config.enginePath) };
}

export async function run(config, output) {
  const runId = Date.now().toString(36) + randomBytes(2).toString('hex');
  const prefix = `tq${runId}`;
  const accounts = Array.from({ length: 10 }, (_, i) => {
    const username = `${prefix}${String(i + 1).padStart(2, '0')}`;
    return {
      username,
      email: config.emailTemplate.replaceAll('{username}', username),
      password: randomBytes(24).toString('base64url'),
      level: i + 1,
    };
  });
  assert(accounts.every(a => a.username.length <= 20));
  const manifest = {
    schema: 1,
    runId,
    prefix,
    baseUrl: config.baseUrl,
    createdAt: new Date().toISOString(),
    tournamentName: `Rehearsal ${runId}`,
    durationMinutes: 20,
    accounts: accounts.map(({ username, email, level }) => ({ username, email, level })),
    games: [],
    status: 'preparing',
    cleanupRequired: true,
  };
  const entryCode = randomBytes(16).toString('hex');
  const directory = resolve(output ?? `.tools/tournament-rehearsal/${runId}`);
  await mkdir(directory, { recursive: false, mode: 0o700 });
  await writeFile(resolve(directory, 'credentials.json'), JSON.stringify({ accounts, entryCode }, null, 2), {
    mode: 0o600,
  });
  let writes = Promise.resolve();
  const save = () => {
    const text = JSON.stringify(manifest, null, 2);
    writes = writes.then(async () => {
      await writeFile(resolve(directory, 'run.json.tmp'), text, { mode: 0o600 });
      await rename(resolve(directory, 'run.json.tmp'), resolve(directory, 'run.json'));
    });
    return writes;
  };
  let events = Promise.resolve();
  const report = (event, details = {}) => {
    const data = { time: new Date().toISOString(), event, ...details };
    console.log(JSON.stringify(data));
    events = events.then(() =>
      appendFile(resolve(directory, 'events.jsonl'), JSON.stringify(data) + '\n', { mode: 0o600 }),
    );
  };
  const players = [],
    engines = [],
    games = new Map();
  let cancelled = false,
    finishedAt,
    startObservedAt,
    lastProgress = Date.now();
  const cancel = () => {
    cancelled = true;
  };
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  await save(); // Durable recovery manifest exists before the first website mutation.
  try {
    for (const account of accounts) {
      const engine = new Engine(
        config.enginePath,
        config.engineCwd ?? dirname(config.enginePath),
        account.level,
      );
      engines.push(engine);
      await engine.start();
    }
    for (const account of accounts) {
      if (cancelled) throw new Error('Interrupted');
      const player = await openPlayer(config, account, report);
      players.push(player);
      player.engine = engines[account.level - 1];
      player.completed = new Set();
      manifest.accounts[account.level - 1].registrationAttemptedAt = new Date().toISOString();
      await save();
      await register(player, config, report);
      manifest.accounts[account.level - 1].registered = true;
      await save();
      if (players.length < 10)
        await delay((config.registrationSpacingSeconds ?? (config.local ? 0 : 130)) * 1000);
    }
    const setup = { ...manifest, entryCode };
    manifest.tournamentId = await createTournament(players[0], config, setup);
    manifest.tournamentCreatedAt = new Date().toISOString();
    await save();
    setup.tournamentId = manifest.tournamentId;
    for (const player of players) await joinTournament(player, config, setup, report);
    manifest.status = 'playing';
    await save();
    report('all-joined', { tournamentId: manifest.tournamentId, players: 10, durationMinutes: 20 });
    // An anonymous observer watches the same rendered tournament page, with no player socket.
    const observerContext = await players[0].browser.newContext({
      locale: 'en-US',
      viewport: { width: 1280, height: 1000 },
    });
    const observer = await observerContext.newPage();
    observer.on('pageerror', error =>
      report('browser-error', { username: 'observer', message: error.message }),
    );
    await observer.goto(`${config.baseUrl}/tournament/${manifest.tournamentId}`, {
      waitUntil: 'domcontentloaded',
    });
    const deadline = Date.now() + 32 * 60 * 1000; // 2 minute lobby + 20 minute event + game drain and bounded tolerance.
    let nextHeartbeat = 0;
    const tick = async player => {
      const { page, account } = player;
      const pathname = new URL(page.url()).pathname;
      if (pathname === `/tournament/${manifest.tournamentId}`) {
        if (finishedAt) return;
        if (account.level === 10 && player.completed.size > 0 && !player.paused) {
          const pause = page.getByRole('button', { name: /Pause/i });
          if (await pause.isVisible()) {
            player.paused = true;
            await pause.click();
            player.resumeAfter = Date.now() + 3000;
            report('pause', { username: account.username });
            return;
          }
        }
        if (player.resumeAfter && Date.now() >= player.resumeAfter) {
          const join = page.getByRole('button', { name: /Join/i });
          if ((await join.isVisible()) && (await join.isEnabled())) {
            await join.click();
            player.resumeAfter = undefined;
            report('resume', { username: account.username });
          }
        }
        const rejoinGame = page.locator('a.tour__ur-playing');
        if (await rejoinGame.isVisible()) await rejoinGame.click();
        return;
      }
      if (!/^\/[a-zA-Z0-9]{8}(?:[a-zA-Z0-9]{4})?$/.test(pathname))
        throw new Error(`Unexpected player page for ${account.username}: ${pathname}`);
      const gameId = pathname.slice(1, 9);
      const result = page.locator('.round__app .result');
      if (await result.isVisible()) {
        const game = games.get(gameId);
        if (!game) throw new Error(`Finished game was never observed: ${gameId}`);
        if (game.busy) return;
        const resultText = (await result.innerText()).trim();
        if (!game.result) {
          game.result = resultText;
          game.finishedAt = new Date().toISOString();
          report('game-finished', { gameId, result: game.result, plies: game.moves.length });
          await saveGames();
        }
        player.completed.add(gameId);
        const back = page.locator(`.rcontrols a[href="/tournament/${manifest.tournamentId}"]`).first();
        await back.waitFor();
        await back.click();
        return;
      }
      if (!(await page.locator('.round__app cg-board').count())) return;
      const board = await readBoard(page);
      if (!board || board.animating) return;
      const side = board.black ? 'black' : 'white';
      const opponentText = (await page.locator('.ruser-top').innerText()).toLowerCase();
      const opponent = accounts.find(a => opponentText.includes(a.username.toLowerCase()));
      if (!opponent || opponent.username === account.username)
        throw new Error('Refusing to play anyone outside this run');
      let game = games.get(gameId);
      if (!game) {
        if (board.placement !== initialPlacement)
          throw new Error(`Unexpected initial board in ${gameId}: ${board.placement}`);
        game = {
          gameId,
          moves: [],
          placement: initialPlacement,
          players: {},
          startedAt: new Date().toISOString(),
          busy: false,
        };
        games.set(gameId, game);
        startObservedAt ??= Date.now();
        lastProgress = Date.now();
        report('paired', { gameId, username: account.username, opponent: opponent.username });
      }
      game.players[side] = account.username;
      if (game.busy || !game.players.white || !game.players.black || board.placement !== game.placement)
        return;
      if ((game.moves.length % 2 === 0 ? 'white' : 'black') !== side) return;
      game.busy = true;
      try {
        if (account.level === 1 && game.moves.length < 2 && !player.berserked) {
          const berserk = page.locator('button.go-berserk');
          if (await berserk.isVisible()) {
            await berserk.click();
            player.berserked = true;
            report('berserk', { gameId, username: account.username });
          }
        }
        if (account.level === 2 && game.moves.length > 12 && !player.reconnected) {
          player.reconnected = true;
          await page.reload({ waitUntil: 'domcontentloaded' });
          report('reload-reconnect', { gameId, username: account.username });
          return;
        }
        const move = await player.engine.move(game.moves);
        const expected = afterMove(game.placement, move);
        await delay(350 + Math.floor(Math.random() * 850));
        if (await result.isVisible()) return; // A clock can expire while the player is thinking.
        await clickMove(page, move, board.black);
        // Verify server acknowledgement through the other player's rendered board.
        const other = players.find(p => p.account.username === opponent.username);
        const timeout = Date.now() + 15000;
        let acknowledged = false;
        while (Date.now() < timeout) {
          if (new URL(other.page.url()).pathname.slice(1, 9) === gameId) {
            const seen = await readBoard(other.page);
            if (seen?.placement === expected && !seen.animating) {
              acknowledged = true;
              break;
            }
            if (
              seen?.placement === game.placement &&
              !seen.animating &&
              (await other.page.locator('.round__app .result').isVisible())
            ) {
              report('move-not-played', { gameId, uci: move, reason: 'game-ended' });
              return;
            }
          }
          await delay(150);
        }
        if (!acknowledged) throw new Error(`Move ${move} in ${gameId} was not rendered by the opponent`);
        game.moves.push(move);
        game.placement = expected;
        lastProgress = Date.now();
        report('move', { gameId, username: account.username, uci: move, ply: game.moves.length });
        await saveGames();
      } finally {
        game.busy = false;
      }
    };
    const saveGames = () => {
      manifest.games = [...games.values()].map(({ busy: _busy, placement: _placement, ...game }) => game);
      return save();
    };
    while (Date.now() < deadline) {
      if (cancelled) throw new Error('Interrupted');
      if (!finishedAt && (await observer.locator('.tour__stats').isVisible())) {
        finishedAt = Date.now();
        manifest.finishedAt = new Date(finishedAt).toISOString();
        report('tournament-finished', { games: games.size });
      }
      const results = await Promise.allSettled(players.map(tick));
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      if (
        finishedAt &&
        players.every(p => new URL(p.page.url()).pathname === `/tournament/${manifest.tournamentId}`)
      )
        break;
      if (!finishedAt && startObservedAt && Date.now() - lastProgress > 150000)
        throw new Error('No moves acknowledged for 150 seconds');
      if (Date.now() > nextHeartbeat) {
        report('progress', {
          pairedGames: games.size,
          completedGames: [...games.values()].filter(g => g.result).length,
        });
        nextHeartbeat = Date.now() + 30000;
      }
      await delay(300);
    }
    assert(finishedAt, 'Tournament never reached the finished screen');
    assert(Date.now() < deadline, 'Outstanding games did not finish before the drain timeout');
    assert(
      finishedAt - startObservedAt > 18 * 60 * 1000,
      'Tournament finished substantially before its 20 minute duration',
    );
    assert(
      players.every(p => p.completed.size >= 2),
      'Every participant must complete at least two games',
    );
    const standings = await observer.locator('.tour__standing tbody tr').evaluateAll(rows =>
      rows.map(row => ({
        username: row.querySelector('.name')?.textContent?.trim(),
        rank: Number(row.querySelector('.rank')?.textContent),
        score: Number(row.querySelector('.total')?.textContent),
        sheet: [...row.querySelectorAll('.sheet > *')].map(score => Number(score.textContent)),
      })),
    );
    assert.equal(standings.length, 10);
    assert.deepEqual(
      new Set(standings.map(p => p.username.toLowerCase())),
      new Set(accounts.map(p => p.username.toLowerCase())),
    );
    for (const [index, player] of standings.entries()) {
      assert.equal(player.rank, index + 1);
      assert.equal(
        player.score,
        player.sheet.reduce((sum, value) => sum + value, 0),
      );
      if (index) assert(standings[index - 1].score >= player.score);
    }
    manifest.standings = standings;
    await events;
    const observedEvents = (await readFile(resolve(directory, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    assert(
      !observedEvents.some(event => event.event === 'browser-error'),
      'Browser JavaScript errors were recorded',
    );
    for (const scenario of ['reload-reconnect', 'pause', 'resume', 'berserk'])
      assert(
        observedEvents.some(event => event.event === scenario),
        `Scenario not exercised: ${scenario}`,
      );
    manifest.scoreVerification = verifyScores(manifest, observedEvents);
    manifest.status = 'passed';
    for (const [label, width] of [
      ['desktop', 1280],
      ['tablet', 768],
      ['mobile', 390],
    ]) {
      await observer.setViewportSize({ width, height: 1000 });
      await observer.screenshot({ path: resolve(directory, `results-${label}.png`), fullPage: true });
    }
    await save();
    report('passed', { output: directory, cleanupRequired: true });
  } catch (error) {
    manifest.status = 'failed';
    manifest.failure = error.message;
    await save();
    await Promise.allSettled(
      players.map(p =>
        p.page.screenshot({ path: resolve(directory, `failure-${p.account.level}.png`), fullPage: true }),
      ),
    );
    throw error;
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    await Promise.allSettled(players.map(p => p.browser.close()));
    await Promise.allSettled(engines.map(e => e.close()));
    await events;
    await writes;
    console.log(
      `Cleanup required: python tools/tournament_rehearsal/cleanup.py --manifest "${resolve(directory, 'run.json')}" --database YOUR_DATABASE --backup BACKUP_DIRECTORY`,
    );
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (!args[0] || args[0] === '--help') {
    console.log('node tools/tournament_rehearsal/run.mjs CONFIG.json [--allow-live] [--output DIRECTORY]');
  } else {
    try {
      const config = validateConfig(
        JSON.parse(await readFile(args[0], 'utf8')),
        args.includes('--allow-live'),
      );
      await mkdir('.tools/tournament-rehearsal', { recursive: true });
      await run(config, args.includes('--output') ? args[args.indexOf('--output') + 1] : undefined);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  }
}
