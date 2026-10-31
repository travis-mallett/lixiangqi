import assert from 'node:assert/strict';

/** Independent check of the published Standard Arena rules against observed browser results. */
export function scoresFor(games, username, berserks = new Set()) {
  let wins = 0,
    drawSinceWin = false;
  return games.map(game => {
    const result = game.result.replaceAll(' ', '');
    assert(['1-0', '0-1', '½-½', '1/2-1/2'].includes(result), `Unknown game result ${result}`);
    const winner = result === '1-0' ? game.players.white : result === '0-1' ? game.players.black : undefined;
    let score;
    if (winner === username) {
      score = (wins >= 2 ? 4 : 2) + (berserks.has(game.gameId) && game.moves.length >= 14 ? 1 : 0);
      wins++;
      drawSinceWin = false;
    } else if (winner) {
      score = 0;
      wins = 0;
    } else {
      score = game.moves.length < 20 ? 0 : wins >= 2 ? 2 : game.moves.length < 60 && drawSinceWin ? 0 : 1;
      wins = 0;
      drawSinceWin = true;
    }
    return score;
  });
}

export function verifyScores(manifest, events) {
  const included = new Map();
  for (const player of manifest.standings) {
    const games = manifest.games
      .filter(game => Object.values(game.players).includes(player.username))
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const berserks = new Set(
      events.filter(e => e.event === 'berserk' && e.username === player.username).map(e => e.gameId),
    );
    assert(player.sheet.length <= games.length, 'Score sheet contains an unobserved game');
    assert.deepEqual(player.sheet, scoresFor(games, player.username, berserks).slice(0, player.sheet.length));
    for (const [index, game] of games.entries()) {
      const counted = index < player.sheet.length;
      if (included.has(game.gameId))
        assert.equal(included.get(game.gameId), counted, 'Only one player was scored');
      included.set(game.gameId, counted);
      // The organizer runs periodically, and browser notifications can arrive slightly later.
      // A game finished well before the boundary must be included for both players.
      if (!counted)
        assert(
          Date.parse(game.finishedAt) >= Date.parse(manifest.finishedAt) - 30000,
          'Earlier game omitted from standings',
        );
    }
  }
  return { countedGames: [...included.values()].filter(Boolean).length, observedGames: included.size };
}
