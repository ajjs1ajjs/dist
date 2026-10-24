import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { keepPreviousOnEmpty, sendBatchAndMark, snapshotUpdatedAt, writeJsonAtomic } from './safety';

test('keeps previous catalog when an upstream response is empty', () => {
  const previous = [{ id: 'known-good' }];
  assert.equal(keepPreviousOnEmpty([], previous), previous);
  assert.deepEqual(keepPreviousOnEmpty([{ id: 'fresh' }], previous), [{ id: 'fresh' }]);
  assert.deepEqual(keepPreviousOnEmpty([], []), []);
});

test('preserves the last successful timestamp for a partial refresh', () => {
  assert.equal(snapshotUpdatedAt(false, 'previous-success', 'current-run'), 'previous-success');
  assert.equal(snapshotUpdatedAt(true, 'previous-success', 'current-run'), 'current-run');
  assert.equal(snapshotUpdatedAt(false, '', 'current-run'), '');
});

test('does not mark notifications when delivery is skipped', async () => {
  const marked: number[] = [];
  const delivered = await sendBatchAndMark([1, 2, 3], 2, async () => false, index => marked.push(index));
  assert.equal(delivered, false);
  assert.deepEqual(marked, []);
});

test('marks only successfully delivered batches', async () => {
  const marked: number[] = [];
  let attempts = 0;
  const delivered = await sendBatchAndMark([1, 2, 3], 2, async () => ++attempts === 1, index => marked.push(index));
  assert.equal(delivered, false);
  assert.deepEqual(marked, [0, 1]);
});

test('atomically replaces a JSON file and leaves no temporary file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dist-fetch-test-'));
  try {
    const filePath = path.join(directory, 'snapshot.json');
    await writeFile(filePath, '{"old":true}\n');
    await writeJsonAtomic(filePath, { current: true });
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), { current: true });
    assert.deepEqual(await readdir(directory), ['snapshot.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
