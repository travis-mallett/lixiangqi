import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
// Use the websocket transport already installed by the repository's jsdom test dependency.
const WebSocket = createRequire(import.meta.resolve('jsdom/package.json'))('ws');
assert.equal(
  process.env.MOBILE_PLAY_SMOKE,
  '1',
  'Explicitly set MOBILE_PLAY_SMOKE=1 for the isolated fixture server',
);
const base = 'http://127.0.0.1:19663';
const clients = new Set();
const headers = token => ({
  Accept: 'application/json',
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'LiXiangQi-Mobile/0.1',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});
async function request(path, token, form, method = form ? 'POST' : 'GET') {
  const response = await fetch(base + path, {
    method,
    headers: { ...headers(token), ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(form ? { body: new URLSearchParams(form) } : {}),
  });
  const text = await response.text();
  assert.ok(response.ok, `${method} ${path} ${response.status}: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
class Lobby {
  constructor(token) {
    this.token = token;
    this.sri = randomUUID().replaceAll('-', '');
    this.events = [];
    clients.add(this);
  }
  async connect() {
    const home = await request('/api/mobile/play', this.token);
    assert.equal(
      home.socketUrl,
      'ws://127.0.0.1:19664/lobby/socket/v5',
      'The smoke must use only the isolated loopback gateway',
    );
    this.ws = new WebSocket(`${home.socketUrl}?sri=${this.sri}`, { headers: headers(home.socketToken) });
    this.ws.on('message', raw => {
      try {
        const data = JSON.parse(raw.toString());
        this.events.push(data);
      } catch {}
    });
    await new Promise((r, j) => {
      this.ws.once('open', r);
      this.ws.once('error', j);
    });
    this.timer = setInterval(() => this.ws.send('null'), 3000);
    this.send('hookIn');
    await wait(350);
    return home;
  }
  send(t, d) {
    this.ws.send(JSON.stringify({ t, ...(d === undefined ? {} : { d }) }));
  }
  async event(t, timeout = 45000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const i = this.events.findIndex(e => e.t === t);
      if (i >= 0) return this.events.splice(i, 1)[0].d;
      await wait(50);
    }
    throw Error(`timeout lobby ${t}: ${JSON.stringify(this.events).slice(0, 200)}`);
  }
  close() {
    clearInterval(this.timer);
    this.ws?.close();
    clients.delete(this);
  }
  hook(time, extra = {}) {
    return request(`/setup/hook/${this.sri}`, this.token, {
      variant: '1',
      timeMode: '1',
      time: String(time),
      increment: '0',
      days: '2',
      color: 'random',
      ...extra,
    });
  }
}
class Game {
  constructor(id, token) {
    this.id = id;
    this.token = token;
    this.events = [];
    this.abort = new AbortController();
    clients.add(this);
  }
  async connect() {
    const res = await fetch(`${base}/api/mobile/game/${this.id}/stream`, {
      headers: headers(this.token),
      signal: this.abort.signal,
    });
    assert.equal(res.status, 200);
    this.read(res).catch(e => {
      if (e.name !== 'AbortError') this.error = e;
    });
    const full = await this.event(x => x.type === 'gameFull');
    this.full = full;
    return full;
  }
  async read(res) {
    let text = '';
    for await (const chunk of res.body) {
      text += Buffer.from(chunk).toString();
      while (text.includes('\n')) {
        const i = text.indexOf('\n'),
          line = text.slice(0, i).trim();
        text = text.slice(i + 1);
        if (line) this.events.push(JSON.parse(line));
      }
    }
  }
  async event(predicate, timeout = 10000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (this.error) throw this.error;
      const i = this.events.findIndex(predicate);
      if (i >= 0) return this.events.splice(i, 1)[0];
      await wait(25);
    }
    throw Error(`timeout game ${this.id} ${JSON.stringify(this.events).slice(0, 300)}`);
  }
  state(predicate, timeout) {
    return this.event(e => e.type === 'gameState' && predicate(e), timeout);
  }
  post(command) {
    return request(`/api/mobile/game/${this.id}/${command}`, this.token, null, 'POST');
  }
  move(uci, millis, lag) {
    return request(
      `/api/mobile/game/${this.id}/move/${uci}`,
      this.token,
      millis === undefined ? (lag === undefined ? null : { lag: String(lag) }) : { millis: String(millis) },
      'POST',
    );
  }
  close() {
    this.abort.abort();
    clients.delete(this);
  }
}
async function guestPair(time, extra = {}) {
  const a = new Lobby(),
    b = new Lobby();
  await a.connect();
  await b.connect();
  await a.hook(time, extra);
  await b.hook(time, extra);
  const ra = await a.event('redirect'),
    rb = await b.event('redirect');
  assert.equal(ra.id.slice(0, 8), rb.id.slice(0, 8));
  a.close();
  b.close();
  const ga = new Game(ra.id),
    gb = new Game(rb.id);
  await ga.connect();
  await gb.connect();
  return ga.full.playerColor === 'red' ? [ga, gb] : [gb, ga];
}
try {
  const caps = { 'moveTime.seconds': '60', 'moveTime.firstMoves': '3', 'moveTime.firstSeconds': '30' };
  const home = await request('/api/mobile/play');
  assert.deepEqual(
    home.pools.map(p => p.id),
    ['15+0-m90-30x3', '5+0-m60-30x3', '10+0-m60-30x3', '20+0-m60-30x3'],
  );
  assert.equal(home.quickPools.length, 11);
  console.log('PASS canonical room bootstrap');
  const [red, black] = await guestPair(5, caps);
  assert.equal(red.full.clock.initial, 300000);
  assert.equal(red.full.moveTime.seconds, 60);
  assert.ok(red.full.state.legalMoves.includes('a4a5'), JSON.stringify(red.full.state));
  const unauthorized = await fetch(`${base}/api/mobile/game/${red.id.slice(0, 8)}/stream`, {
    headers: headers(),
  });
  assert.equal(unauthorized.status, 404);
  const invalidTiming = await fetch(base + `/api/mobile/game/${red.id}/move/a4a5`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ millis: '-1' }),
  });
  assert.equal(invalidTiming.status, 400);
  await invalidTiming.text();
  const invalidLag = await fetch(base + `/api/mobile/game/${red.id}/move/a4a5`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ lag: '-1' }),
  });
  assert.equal(invalidLag.status, 400);
  await invalidLag.text();
  await red.move('a4a5', undefined, 25);
  await black.state(s => s.moves === 'a4a5');
  await black.move('a7a6', 0);
  await red.state(s => s.moves === 'a4a5 a7a6');
  console.log('PASS guest ownership, legal moves, opponent stream updates');
  // Keep the game alive beyond an initial connection's age, then verify a
  // new disconnection receives a fresh grace period and reconnect clears it.
  await wait(10000);
  red.events = red.events.filter(event => event.type !== 'opponentGone');
  black.close();
  const gone = await red.event(e => e.type === 'opponentGone' && e.gone, 15000);
  assert.ok(gone.claimWinInSeconds > 15, 'Disconnect grace starts at the last stream close');
  black.abort = new AbortController();
  clients.add(black);
  await black.connect();
  await red.event(e => e.type === 'opponentGone' && e.gone === false);
  console.log('PASS disconnect grace and opponent reconnect notification');
  await red.post('takeback/true');
  await black.state(s => s.rtakeback);
  await black.post('takeback/true');
  await red.state(s => s.moves === '');
  await black.state(s => s.moves === '');
  console.log('PASS takeback offer and rollback streamed');
  await red.move('a4a5');
  await black.state(s => s.moves === 'a4a5');
  await black.move('a7a6');
  await red.state(s => s.moves === 'a4a5 a7a6');
  await red.post('draw/true');
  await black.state(s => s.rdraw);
  await black.post('draw/false');
  await red.state(s => !s.rdraw && s.moves === 'a4a5 a7a6');
  console.log('PASS draw offer and decline streamed');
  await red.post('moretime');
  await black.state(s => s.btime > 305000);
  console.log('PASS giving time streamed');
  await red.post('resign');
  await black.state(s => s.status === 'resign');
  red.close();
  black.close();
  console.log('PASS resignation and game end');
  await red.post('rematch/true');
  await black.post('rematch/true');
  await wait(750);
  const replay = new Game(red.id);
  await replay.connect();
  assert.equal(replay.full.state.rematch.length, 12);
  const rematch = new Game(replay.full.state.rematch);
  await rematch.connect();
  assert.equal(rematch.full.playerColor, 'black');
  await rematch.post('abort');
  replay.close();
  rematch.close();
  console.log('PASS guest rematch capability and reversed colors');
  for (const minutes of [10, 20]) {
    const [r, b] = await guestPair(minutes, caps);
    assert.equal(r.full.clock.initial, minutes * 60000);
    assert.equal(r.full.moveTime.first.seconds, 30);
    await r.post('abort');
    await b.state(s => s.status === 'aborted');
    r.close();
    b.close();
    console.log(`PASS ${minutes}-minute room and abort`);
  }
  const [customA, customB] = await guestPair(7, { increment: '2', 'moveTime.seconds': '45' });
  assert.equal(customA.full.clock.initial, 420000);
  assert.equal(customA.full.clock.increment, 2000);
  assert.equal(customA.full.moveTime.seconds, 45);
  assert.equal(customA.full.state.poolId, undefined);
  await customA.post('abort');
  customA.close();
  customB.close();
  console.log('PASS custom clock, increment, move limit');
  const likeA = new Lobby(),
    likeB = new Lobby();
  await likeA.connect();
  await likeB.connect();
  await request(`/setup/hook/${likeA.sri}/like/${customA.id.slice(0, 8)}`, null, null, 'POST');
  await likeB.hook(7, { increment: '2', 'moveTime.seconds': '45' });
  const [likeRedirectA, likeRedirectB] = await Promise.all([
    likeA.event('redirect'),
    likeB.event('redirect'),
  ]);
  likeA.close();
  likeB.close();
  const likeGameA = new Game(likeRedirectA.id),
    likeGameB = new Game(likeRedirectB.id);
  await likeGameA.connect();
  await likeGameB.connect();
  assert.equal(likeGameA.full.clock.initial, 420000);
  assert.equal(likeGameA.full.clock.increment, 2000);
  assert.equal(likeGameA.full.moveTime.seconds, 45);
  assert.equal(likeGameA.full.ranked, false);
  await likeGameA.post('abort');
  likeGameA.close();
  likeGameB.close();
  console.log('PASS custom new opponent preserves canonical game controls');
  console.log('ALL GUEST SMOKE CHECKS PASSED');

  const tokens = [1, 2].map(n => `mobile-smoke-local-fixture-${n}`);
  const pa = new Lobby(tokens[0]),
    pb = new Lobby(tokens[1]);
  await pa.connect();
  await pb.connect();
  const enter = () => {
    pa.send('poolIn', { id: '15+0-m90-30x3' });
    pb.send('poolIn', { id: '15+0-m90-30x3' });
  };
  enter();
  const renew = setInterval(enter, 10000);
  let pra, prb;
  try {
    [pra, prb] = await Promise.all([pa.event('redirect', 100000), pb.event('redirect', 100000)]);
  } finally {
    clearInterval(renew);
    pa.close();
    pb.close();
  }
  assert.equal(pra.id.slice(0, 8), prb.id.slice(0, 8));
  const pga = new Game(pra.id.slice(0, 8), tokens[0]),
    pgb = new Game(prb.id.slice(0, 8), tokens[1]);
  await pga.connect();
  await pgb.connect();
  const [pr, pbgame] = pga.full.playerColor === 'red' ? [pga, pgb] : [pgb, pga];
  assert.equal(pr.full.ranked, true);
  assert.equal(pr.full.clock.initial, 900000);
  assert.equal(pr.full.moveTime.seconds, 90);
  assert.equal(pr.full.state.poolId, '15+0-m90-30x3');
  await pr.move('a4a5');
  await pbgame.state(s => s.moves === 'a4a5');
  await pbgame.move('a7a6');
  await pr.state(s => s.moves === 'a4a5 a7a6');
  await pr.post('resign');
  await pbgame.state(s => s.status === 'resign');
  pga.close();
  pgb.close();
  console.log('PASS authenticated ranked 15-minute pool match and completed game');

  for (const mode of ['2', '0']) {
    const lobby = new Lobby(tokens[0]);
    await lobby.connect();
    const created = await lobby.hook(5, { timeMode: mode, days: '2' });
    const seekId = created.hook.id;
    await wait(350);
    const seeks = await request('/lobby/seeks', tokens[0]);
    assert.ok(seeks.some(s => s.id === seekId));
    await request(`/api/mobile/play/seek/${seekId}`, tokens[0], null, 'DELETE');
    const remaining = await request('/lobby/seeks', tokens[0]);
    assert.ok(!remaining.some(s => s.id === seekId));
    lobby.close();
    console.log(`PASS ${mode === '2' ? 'correspondence' : 'unlimited'} custom seek create/list/cancel`);
    const first = new Lobby(tokens[0]),
      second = new Lobby(tokens[1]);
    await first.connect();
    await second.connect();
    const waiting = await first.hook(5, { timeMode: mode, days: '2' });
    await wait(350);
    second.send('joinSeek', waiting.hook.id);
    const [redirectA, redirectB] = await Promise.all([first.event('redirect'), second.event('redirect')]);
    first.close();
    second.close();
    const gameA = new Game(redirectA.id.slice(0, 8), tokens[0]);
    const gameB = new Game(redirectB.id.slice(0, 8), tokens[1]);
    await gameA.connect();
    await gameB.connect();
    assert.equal(gameA.full.clock, undefined);
    assert.equal(gameA.full.daysPerTurn, mode === '2' ? 2 : undefined);
    assert.equal(gameA.full.state.clockRunning, mode === '2');
    await gameA.post('abort');
    gameA.close();
    gameB.close();
    console.log(`PASS ${mode === '2' ? 'correspondence' : 'unlimited'} seek join and native game stream`);
  }

  const friendForm = {
    variant: '1',
    timeMode: '1',
    time: '5',
    increment: '3',
    days: '2',
    color: 'random',
    ruleset: 'tiantian-v1',
  };
  const friend = await request('/setup/friend?user=MobileSmoke2', tokens[0], friendForm);
  const challengeId = friend.challenge.id;
  assert.equal((await request(`/api/challenge/${challengeId}/show`, tokens[0])).direction, 'out');
  for (let attempt = 0; attempt < 4; attempt++) {
    await wait(6000);
    assert.equal((await request(`/api/challenge/${challengeId}/show`, tokens[0])).status, 'created');
  }
  console.log('PASS challenge owner polling keeps a real-time offer online');
  assert.equal((await request(`/api/challenge/${challengeId}/show`, tokens[1])).direction, 'in');
  const accepted = await request(`/api/challenge/${challengeId}/accept`, tokens[1], null, 'POST');
  assert.equal(accepted.fullId.length, 12);
  const fa = new Game(challengeId, tokens[0]),
    fb = new Game(challengeId, tokens[1]);
  await fa.connect();
  await fb.connect();
  assert.equal(fa.full.source, 'friend');
  await fa.post('abort');
  fa.close();
  fb.close();
  const cancel = await request('/setup/friend', tokens[0], { ...friendForm, timeMode: '0' });
  await request(`/api/challenge/${cancel.challenge.id}/cancel`, tokens[0], null, 'POST');
  assert.equal((await request(`/api/challenge/${cancel.challenge.id}/show`, tokens[0])).status, 'canceled');
  console.log('PASS signed-in friend create/show/accept/play/cancel');

  const anonHome = await fetch(base + '/api/mobile/play', { headers: headers() });
  const cookie = anonHome.headers.get('set-cookie').split(';')[0];
  assert.ok(cookie);
  await anonHome.text();
  const anonHeaders = { ...headers(), Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' };
  const anonCreate = await fetch(base + '/setup/friend', {
    method: 'POST',
    headers: anonHeaders,
    body: new URLSearchParams(friendForm),
  });
  assert.equal(anonCreate.status, 200);
  const anon = (await anonCreate.json()).challenge;
  const anonShow = await fetch(base + `/api/challenge/${anon.id}/show`, { headers: anonHeaders });
  assert.equal((await anonShow.json()).direction, 'out');
  const acceptResponse = await fetch(base + `/api/challenge/${anon.id}/accept`, {
    method: 'POST',
    headers: headers(),
  });
  assert.equal(acceptResponse.status, 200);
  const acceptCookie = acceptResponse.headers.get('set-cookie').split(';')[0];
  const anonAccept = await acceptResponse.json();
  assert.equal(anonAccept.fullId.length, 12);
  const recoveredResponse = await fetch(base + `/api/challenge/${anon.id}/show`, {
    headers: { ...headers(), Cookie: acceptCookie },
  });
  assert.equal((await recoveredResponse.json()).fullId, anonAccept.fullId);
  const anonOwner = await fetch(base + `/api/challenge/${anon.id}/show`, { headers: anonHeaders });
  const ownerData = await anonOwner.json();
  assert.equal(ownerData.fullId.length, 12);
  assert.notEqual(ownerData.fullId, anonAccept.fullId);
  const publicData = await request(`/api/challenge/${anon.id}/show`);
  assert.equal(publicData.fullId, undefined);
  const guestOwner = new Game(ownerData.fullId),
    guestOther = new Game(anonAccept.fullId);
  await guestOwner.connect();
  await guestOther.connect();
  await guestOwner.post('abort');
  guestOwner.close();
  guestOther.close();
  console.log('PASS guest friend session, acceptance and public capability isolation');
  console.log('ALL MOBILE PLAY SMOKE CHECKS PASSED');
} finally {
  for (const client of clients) client.close();
}
