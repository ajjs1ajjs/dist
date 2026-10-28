import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimNextMessage, classifyDeliveryFailure, emptyOutbox, enqueueMessage, normalizeOutbox, pendingReceiptKeys,
  recordDeliveryOutcome,
} from './outbox';
import type { OutboxReceipt } from './outbox';

const receipt: OutboxReceipt = {
  key: 'steam_discount_42',
  entry: { title: 'Game', price: 5, percent: 50, timestamp: '2026-10-28T00:00:00.000Z', type: 'discount' },
};

test('outbox enqueue is deterministic and does not duplicate pending receipts', () => {
  const outbox = emptyOutbox();
  const first = enqueueMessage(outbox, '<b>Game</b>', [receipt], new Date('2026-10-28T00:00:00.000Z'));
  const second = enqueueMessage(outbox, '<b>Game</b>', [receipt], new Date('2026-10-28T00:01:00.000Z'));
  assert.ok(first);
  assert.equal(second, undefined);
  assert.equal(outbox.messages.length, 1);
  assert.deepEqual([...pendingReceiptKeys(outbox)], [receipt.key]);
});

test('a stale sending claim becomes uncertain and is never automatically resent', () => {
  const outbox = emptyOutbox();
  enqueueMessage(outbox, '<b>Game</b>', [receipt], new Date('2026-10-28T00:00:00.000Z'));
  const claimed = claimNextMessage(outbox, new Date('2026-10-28T00:01:00.000Z'));
  assert.equal(claimed?.status, 'sending');
  assert.equal(claimNextMessage(outbox, new Date('2026-10-28T00:02:00.000Z')), undefined);
  assert.equal(outbox.messages[0].status, 'uncertain');
  assert.equal(outbox.messages[0].attempts, 1);
});

test('known retries stay pending and successful delivery becomes delivered', () => {
  const outbox = emptyOutbox();
  const item = enqueueMessage(outbox, '<b>Game</b>', [receipt])!;
  claimNextMessage(outbox);
  recordDeliveryOutcome(outbox, item.id, { kind: 'retry', error: 'HTTP 429', retryAt: new Date(Date.now() + 60_000) });
  assert.equal(item.status, 'pending');
  assert.ok(item.nextAttemptAt);

  item.status = 'pending';
  delete item.nextAttemptAt;
  claimNextMessage(outbox);
  recordDeliveryOutcome(outbox, item.id, { kind: 'delivered' });
  assert.equal(item.status, 'delivered');
});

test('only Telegram rate limits retry automatically; ambiguous outcomes need review', () => {
  const now = new Date('2026-10-28T00:00:00.000Z');
  assert.deepEqual(classifyDeliveryFailure('HTTP_429', 'rate limited', now), {
    kind: 'retry', error: 'rate limited', retryAt: new Date('2026-10-28T00:15:00.000Z'),
  });
  assert.deepEqual(classifyDeliveryFailure('HTTP_503', 'server error', now), {
    kind: 'uncertain', error: 'server error',
  });
  assert.deepEqual(classifyDeliveryFailure(undefined, 'socket timeout', now), {
    kind: 'uncertain', error: 'socket timeout',
  });
  assert.deepEqual(classifyDeliveryFailure('HTTP_400', 'bad request', now), {
    kind: 'blocked', error: 'bad request',
  });
});

test('corrupt outbox state fails closed instead of being replaced with an empty queue', () => {
  assert.throws(() => normalizeOutbox({ schemaVersion: 9, messages: [] }), /Unsupported/);
  assert.throws(() => normalizeOutbox({ schemaVersion: 1, messages: [{ id: 'bad' }] }), /Invalid/);
});
