// Run with application writers stopped. Original documents (including ratings,
// votes and counters) survive in an immutable recovery collection. Player rounds,
// accounts, games and preferences are untouched. Interrupted runs are resumable.
(() => {
  if (db.puzzle2_publication.findOne({ _id: 'control', operation: { $exists: true, $ne: null } }))
    throw new Error('Recover pending puzzle publication before removing unsupported objectives');
  const puzzles = db.puzzle2_puzzle;
  const backup = db.getCollection('__retired_puzzle_objectives_v1');
  const unsupported = { 'playback.objective': { $exists: true, $nin: ['mate', 'tactic'] } };
  let removed = 0;
  for (const original of puzzles.find(unsupported)) {
    const saved = backup.findOne({ _id: original._id });
    if (saved && EJSON.stringify(saved) !== EJSON.stringify(original))
      throw new Error(`Recovery document differs for ${original._id}`);
    if (!saved) backup.insertOne(original);
    if (!backup.findOne({ _id: original._id })) throw new Error('Recovery write failed');
    puzzles.deleteOne({ _id: original._id, 'playback.objective': original.playback.objective });
    removed++;
  }
  if (puzzles.countDocuments(unsupported)) throw new Error('Unsupported puzzle objectives remain');
  print(`Archived ${removed} unsupported puzzles; player records retained`);
})();
