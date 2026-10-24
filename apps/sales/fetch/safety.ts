import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Keep the last known-good catalog when an upstream suddenly returns no rows. */
export function keepPreviousOnEmpty<T>(fresh: T[], previous: T[]): T[] {
  return fresh.length === 0 && previous.length > 0 ? previous : fresh;
}

/** Do not label a partial refresh as a full catalog refresh. */
export function snapshotUpdatedAt(complete: boolean, previous: string, now: string): string {
  return complete ? now : previous;
}

/** Atomically replace a JSON snapshot so readers never see a partial document. */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(tempPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(tempPath, filePath);
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

/** Only mark a batch after delivery succeeds; a skipped sender leaves it retryable. */
export async function sendBatchAndMark<T>(
  items: T[],
  batchSize: number,
  send: (batch: T[]) => Promise<boolean>,
  markSent: (index: number) => void,
): Promise<boolean> {
  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);
    if (!(await send(batch))) return false;
    for (let index = 0; index < batch.length; index++) markSent(start + index);
  }
  return true;
}
