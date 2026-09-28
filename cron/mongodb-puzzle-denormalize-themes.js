/* Denormalize puzzle themes based on round theme votes.
 * Only looks for puzzles with the `dirty` flag, and removes it.
 *
 * mongosh <IP>:<PORT>/<DB> mongodb-puzzle-denormalize-themes.js
 *
 * Must run on the puzzle database.
 * Should run every 5 minutes.
 * Should complete within 10 seconds.
 * OK to run many times in a row.
 * OK to skip runs.
 * OK to run concurrently.
 */

const playColl = db.puzzle2_puzzle;
const _roundColl = db.puzzle2_round;

db.puzzle2_puzzle
  .aggregate([
    { $match: { dirty: true } },
    { $project: { _id: 1, themes: 1, managedThemes: 1, authorRevision: 1, themeVersion: 1 } },
    {
      $lookup: {
        from: 'puzzle2_round',
        let: { id: '$_id' },
        pipeline: [
          { $match: { $and: [{ $expr: { $eq: ['$p', '$$id'] } }, { t: { $exists: true } }] } },
          { $project: { _id: 0, t: 1, e: 1 } },
          { $unwind: '$t' },
          { $group: { _id: '$t', v: { $sum: '$e' } } },
        ],
        as: 'rounds',
      },
    },
  ])
  .forEach(p => {
    const oldThemes = p.themes || [];
    const themeMap = {};

    p.rounds.forEach(x => {
      const signum = x._id[0] === '+' ? 1 : -1;
      const theme = x._id.substring(1);
      themeMap[theme] = x.v * signum + (themeMap[theme] || 0);
    });

    const newThemes = new Set();
    Object.keys(themeMap).forEach(theme => {
      if (themeMap[theme] > 80) newThemes.add(theme);
    });

    // Authoring and community themes have separate ownership, including when
    // both sources support the same theme. A changed author or vote version
    // leaves dirty set so the next run recomputes from current rounds.
    playColl.updateOne(
      {
        _id: p._id,
        themes: oldThemes,
        authorRevision: p.authorRevision ?? null,
        themeVersion: p.themeVersion ?? null,
      },
      {
        $unset: { dirty: true },
        $set: {
          communityThemes: Array.from(newThemes),
          themes: Array.from(new Set([...(p.managedThemes || []), ...newThemes])),
        },
      },
    );
  });
