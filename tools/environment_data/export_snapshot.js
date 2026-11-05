/* Read-only production snapshot extraction. game5 field names belong to
 * modules/game BSONHandlers/Game.BSONFields, not the old mining HTTP API. */
const fs = require('node:fs');
const path = require('node:path');
async function exportSnapshot(database, output, origin) {
  if (!path.isAbsolute(output) || typeof origin !== 'string' || !/^https:\/\/[^/]+$/.test(origin))
    throw new Error('absolute staging path and HTTPS production origin required');
  fs.mkdirSync(output, { recursive: true });
  const publication = await database.getCollection('puzzle2_publication').findOne({ _id: 'control' });
  if (publication?.operation)
    throw new Error('Puzzle publication is pending; let the application recover it before taking a snapshot');
  const games = database.getCollection('game5');
  const nativeSource = game => {
    if (game?.xv !== 1 || typeof game.xg?.initialFen !== 'string' || !Array.isArray(game.xg.moves))
      throw new Error('missing canonical native source game');
    return {
      initialFen: game.xg.initialFen,
      moves: game.xg.moves,
      players: (game.us || [])
        .slice(0, 2)
        .map((userId, i) => ({ color: i === 0 ? 'red' : 'black', ...(userId ? { userId } : {}) })),
      rated: game.ra === true,
    };
  };
  let nativeGames = 0;
  const fd = fs.openSync(path.join(output, 'native-games.jsonl'), 'wx');
  try {
    const cursor = await (
      await games.find({
        xv: 1,
        s: { $gte: 30 },
        so: { $nin: [7, 9] },
        pgni: { $exists: false },
        co: { $type: 'date' },
      })
    ).sort({ _id: 1 });
    while (await cursor.hasNext()) {
      const game = await cursor.next();
      const snapshot = nativeSource(game);
      nativeGames++;
      fs.writeSync(
        fd,
        JSON.stringify({
          id: game._id,
          initialFen: snapshot.initialFen,
          moves: snapshot.moves,
          players: (game.us || []).slice(0, 2),
          completedAt: game.co.getTime(),
          ruleset: game.xg.ruleset || 'unrestricted-v1',
        }) + '\n',
      );
    }
  } finally {
    fs.closeSync(fd);
  }
  // Keep only a bounded driver batch and one puzzle in memory. A whole-corpus
  // array plus JSON.stringify can exhaust the isolated snapshot's memory limit.
  const inventory = fs.openSync(path.join(output, 'puzzle-inventory.json'), 'wx');
  const revisionPath = path.join(output, 'publication-revisions.json.part');
  const pendingPath = path.join(output, 'pending-sources.json.part');
  const revisions = fs.openSync(revisionPath, 'wx');
  const pending = fs.openSync(pendingPath, 'wx');
  let puzzles = 0;
  let pendingSources = 0;
  try {
    fs.writeSync(inventory, '{"schemaVersion":2,"puzzles":[');
    const cursor = await (
      await database.getCollection('puzzle2_puzzle').find({})
    )
      .sort({ _id: 1 })
      .batchSize(100);
    while (await cursor.hasNext()) {
      const p = await cursor.next();
      const source = p.gameSource?.type === 'catalog' ? p.gameSource : { type: 'native', origin };
      let snapshot = p.sourceSnapshot;
      if (!snapshot && source.type === 'native')
        snapshot = nativeSource(await games.findOne({ _id: p.gameId }));
      if (!snapshot) {
        snapshot = null;
        fs.writeSync(pending, (pendingSources++ ? ',' : '') + JSON.stringify(p._id));
      }
      fs.writeSync(
        revisions,
        (puzzles ? ',' : '') + JSON.stringify(p._id) + ':' + JSON.stringify(p.authorRevision ?? null),
      );
      fs.writeSync(
        inventory,
        (puzzles++ ? ',' : '') +
          JSON.stringify({
            _id: p._id,
            gameId: p.gameId,
            gameSource: source,
            fen: p.fen,
            line: p.line,
            themes: p.managedThemes || p.themes,
            retired: p.retired === true,
            retirementReason: p.retired ? p.retirementReason || 'Retired before catalog migration' : null,
            sourceSnapshot: snapshot,
            ...(p.playback ? { playback: p.playback } : {}),
          }),
      );
    }
    fs.writeSync(inventory, '],"pendingSources":[');
    for await (const chunk of fs.createReadStream(pendingPath)) fs.writeSync(inventory, chunk);
    fs.writeSync(
      inventory,
      '],"publication":{"version":' + JSON.stringify(publication?.version || 'bootstrap') + ',"revisions":{',
    );
    for await (const chunk of fs.createReadStream(revisionPath)) fs.writeSync(inventory, chunk);
    fs.writeSync(inventory, '}}}\n');
  } finally {
    fs.closeSync(inventory);
    fs.closeSync(revisions);
    fs.closeSync(pending);
    fs.unlinkSync(revisionPath);
    fs.unlinkSync(pendingPath);
  }
  return {
    nativeGames,
    puzzles,
    pendingSources,
  };
}
if (typeof module !== 'undefined') module.exports = { exportSnapshot };
