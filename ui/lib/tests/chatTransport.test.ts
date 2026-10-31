import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChatOpts } from '../src/chat/interfaces';
import { pubsub } from '../src/pubsub';

document.documentElement.lang = 'en';
const { ChatCtrl } = await import('../src/chat/chatCtrl');

const options = (): ChatOpts => ({
  data: {
    id: 'test',
    name: 'Chat',
    lines: [],
    userId: 'me',
    resourceType: 'round',
    resourceId: 'test',
    loginRequired: true,
    restricted: false,
    voiceChat: false,
  },
  writeable: true,
  kobold: false,
  blind: false,
  timeout: false,
  public: false,
  permissions: {},
  kidMode: false,
});

test('an HTTP room uses shared chat validation without receiving or sending unrelated socket chat', () => {
  const sent: string[] = [];
  const ctrl = new ChatCtrl(
    {
      ...options(),
      post: text => {
        sent.push(text);
        return true;
      },
    },
    () => {},
  );
  assert.equal(ctrl.post('   '), false);
  assert.equal(ctrl.post(' hello '), true);
  assert.deepEqual(sent, ['hello']);
  pubsub.emit('socket.in.message', { u: 'me', t: 'another room', d: false });
  assert.equal(ctrl.data.lines.length, 0);
  ctrl.destroy();
});

test('socket rooms retain incoming chat and release subscriptions when replaced', () => {
  const ctrl = new ChatCtrl(options(), () => {});
  pubsub.emit('socket.in.message', { u: 'me', t: 'hello', d: false });
  assert.equal(ctrl.data.lines.length, 1);
  ctrl.destroy();
  pubsub.emit('socket.in.message', { u: 'me', t: 'after leaving', d: false });
  assert.equal(ctrl.data.lines.length, 1);
});
