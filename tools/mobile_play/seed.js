if (db.getName() !== 'mobile_play_smoke') throw Error('Isolated smoke database required');
if (!db.getMongo().getURI().startsWith('mongodb://127.0.0.1:27319/'))
  throw Error('Isolated loopback database required');
const crypto = require('node:crypto');
for (const n of [1, 2]) {
  const id = `mobilesmoke${n}`;
  db.user4.updateOne(
    { _id: id },
    {
      $setOnInsert: {
        username: `MobileSmoke${n}`,
        enabled: true,
        createdAt: new Date(),
        email: `${id}@example.invalid`,
        count: { game: 0, rated: 0, win: 0, loss: 0, draw: 0 },
      },
    },
    { upsert: true },
  );
  const token = `mobile-smoke-local-fixture-${n}`;
  db.oauth2_access_token.updateOne(
    { _id: crypto.createHash('sha256').update(token).digest('hex') },
    {
      $set: {
        plain: token,
        userId: id,
        scopes: ['mobile:play'],
        created: new Date(),
        expires: new Date(Date.now() + 86400000),
      },
    },
    { upsert: true },
  );
}
print('Created two isolated mobile play fixtures');
