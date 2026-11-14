import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const fetchDir = path.dirname(fileURLToPath(import.meta.url));

const receipt = {
  key: 'steam_discount_test-42',
  entry: {
    title: 'Fixture Game',
    price: 5,
    percent: 50,
    timestamp: '2026-10-28T00:00:00.000Z',
    type: 'discount',
  },
};

async function runSendClaimed(mode: string, photoUrl?: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dist-outbox-integration-'));
  const dataDir = path.join(root, 'data');
  const callsFile = path.join(root, 'calls.txt');
  await mkdir(dataDir);
  await writeFile(path.join(dataDir, 'notification-outbox.json'), JSON.stringify({
    schemaVersion: 1,
    messages: [{
      id: 'fixture-message',
      createdAt: '2026-10-28T00:00:00.000Z',
      text: '<b>Fixture notification</b>',
      ...(photoUrl ? { photoUrl } : {}),
      receipts: [receipt],
      status: 'sending',
      attempts: 1,
      claimedAt: '2026-10-28T00:01:00.000Z',
    }],
  }));

  const fetchMock = path.join(root, 'mock-fetch.mjs');
  await writeFile(fetchMock, `
    import { appendFile } from 'node:fs/promises';
    globalThis.fetch = async (url, init) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : null;
      await appendFile(process.env.DIST_TEST_CALLS_FILE, JSON.stringify({ url: String(url), payload }) + '\\n');
      if (process.env.DIST_TEST_FETCH_MODE === 'network') throw new Error('mock socket timeout');
      let status = Number(process.env.DIST_TEST_FETCH_MODE);
      if (process.env.DIST_TEST_FETCH_MODE === '400-then-200') {
        status = String(url).endsWith('/sendPhoto') ? 400 : 200;
      }
      const body = status === 200 ? { ok: true, result: { message_id: 42 } } : { ok: false };
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    };
  `);

  try {
    const child = spawnSync(process.execPath, [
      '--import', 'tsx', '--import', pathToFileURL(fetchMock).href, 'fetch-deals.ts', '--send-claimed',
    ], {
      cwd: fetchDir,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        DEALS_DIR: dataDir,
        TELEGRAM_BOT_TOKEN: 'fixture-token',
        TELEGRAM_CHAT_ID: 'fixture-chat',
        DIST_TEST_CALLS_FILE: callsFile,
        DIST_TEST_FETCH_MODE: mode,
      },
    });
    const outbox = JSON.parse(await readFile(path.join(dataDir, 'notification-outbox.json'), 'utf8'));
    const historyPath = path.join(dataDir, 'notified-history.json');
    const history = await readFile(historyPath, 'utf8').then(JSON.parse).catch(() => ({}));
    const calls = await readFile(callsFile, 'utf8').then((text) => text.trim().split(/\r?\n/).filter(Boolean)).catch(() => []);
    return { child, outbox, history, calls };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('successful CLI delivery makes exactly one request and commits receipt history', async () => {
  const result = await runSendClaimed('200');
  assert.equal(result.child.status, 0, result.child.stderr);
  assert.equal(result.calls.length, 1);
  assert.equal(result.outbox.messages[0].status, 'delivered');
  assert.equal(result.history[receipt.key].title, 'Fixture Game');
});

test('HTTP 429 leaves the claimed message pending with one durable retry time', async () => {
  const result = await runSendClaimed('429');
  assert.equal(result.child.status, 0, result.child.stderr);
  assert.equal(result.calls.length, 1);
  assert.equal(result.outbox.messages[0].status, 'pending');
  assert.ok(Date.parse(result.outbox.messages[0].nextAttemptAt) > Date.now());
  assert.deepEqual(result.history, {});
});

test('HTTP 5xx is uncertain and is never retried by the same command', async () => {
  const result = await runSendClaimed('503');
  assert.equal(result.child.status, 0, result.child.stderr);
  assert.equal(result.calls.length, 1);
  assert.equal(result.outbox.messages[0].status, 'uncertain');
  assert.deepEqual(result.history, {});
});

test('a lost network response is uncertain and is never retried by the same command', async () => {
  const result = await runSendClaimed('network');
  assert.equal(result.child.status, 0, result.child.stderr);
  assert.equal(result.calls.length, 1);
  assert.equal(result.outbox.messages[0].status, 'uncertain');
  assert.deepEqual(result.history, {});
});

test('photo notification sends sendPhoto with photo and HTML caption in one request', async () => {
  const photoUrl = 'https://cdn.example.com/cover.jpg';
  const result = await runSendClaimed('200', photoUrl);
  assert.equal(result.child.status, 0, result.child.stderr);
  assert.equal(result.calls.length, 1);
  const call = JSON.parse(result.calls[0]);
  assert.ok(call.url.endsWith('/sendPhoto'));
  assert.equal(call.payload.photo, photoUrl);
  assert.equal(call.payload.caption, '<b>Fixture notification</b>');
  assert.equal(result.outbox.messages[0].status, 'delivered');
  assert.equal(result.history[receipt.key].title, 'Fixture Game');
});

test('sendPhoto HTTP 400 falls back to sendMessage once and commits receipt history', async () => {
  const result = await runSendClaimed('400-then-200', 'https://cdn.example.com/broken.jpg');
  assert.equal(result.child.status, 0, result.child.stderr);
  assert.equal(result.calls.length, 2);
  const firstCall = JSON.parse(result.calls[0]);
  const secondCall = JSON.parse(result.calls[1]);
  assert.ok(firstCall.url.endsWith('/sendPhoto'));
  assert.ok(secondCall.url.endsWith('/sendMessage'));
  assert.equal(secondCall.payload.text, '<b>Fixture notification</b>');
  assert.equal(result.outbox.messages[0].status, 'delivered');
  assert.equal(result.history[receipt.key].title, 'Fixture Game');
});

test('sendPhoto HTTP 503 does not fall back to sendMessage', async () => {
  const result = await runSendClaimed('503', 'https://cdn.example.com/cover.jpg');
  assert.equal(result.child.status, 0, result.child.stderr);
  assert.equal(result.calls.length, 1);
  assert.ok(JSON.parse(result.calls[0]).url.endsWith('/sendPhoto'));
  assert.equal(result.outbox.messages[0].status, 'uncertain');
  assert.deepEqual(result.history, {});
});
