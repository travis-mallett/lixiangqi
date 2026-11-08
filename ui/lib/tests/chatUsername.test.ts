import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pubsub } from '../src/pubsub';
import { userProfilePath } from '../src/username';

document.documentElement.lang = 'en';
const { moderationCtrl } = await import('../src/chat/moderation');

test('chat timeout sends the account ID rather than its URL encoding', () => {
  for (const name of ['石头', '象棋Player88', '𠮷野', 'Alice_123']) {
    const line = document.createElement('li');
    line.innerHTML = `<a class="user-link" href="${userProfilePath(name)}">${name}</a><t></t>`;
    line.querySelector('t')!.innerText = 'Hello';
    const ctrl = moderationCtrl({
      permissions: { timeout: false },
      reasons: [],
      resourceId: 'study/12345678',
      redraw: () => {},
    });
    ctrl.open(line);
    assert.deepEqual(ctrl.data(), { id: name.toLowerCase(), name, text: 'Hello' });
    let sent: unknown;
    const receive = (type: string, data: unknown) => {
      if (type === 'timeout') sent = data;
    };
    pubsub.on('socket.send', receive);
    try {
      ctrl.timeout({ key: 'spam', name: 'Spam' }, 'Hello');
      assert.deepEqual(sent, { userId: name.toLowerCase(), reason: 'spam', text: 'Hello' });
    } finally {
      pubsub.off('socket.send', receive);
    }
  }
});
