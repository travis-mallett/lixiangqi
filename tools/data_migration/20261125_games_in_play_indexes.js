// Keep historical games outside the counter indexes. Attendance is looked up by game _id.
db.game5.createIndex(
  { s: 1, so: 1, mp: 1 },
  { name: 'in_play_realtime', partialFilterExpression: { s: 20, c: { $exists: true } } },
);
db.three_kingdoms_game.createIndex(
  { finished: 1, 'clock.config.initialSeconds': 1, 'clock.config.incrementSeconds': 1 },
  { name: 'in_play_realtime', partialFilterExpression: { finished: false } },
);
