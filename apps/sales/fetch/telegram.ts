export interface TelegramBatch<T> {
  items: T[];
  text: string;
  photoUrl?: string;
}

export function normalizeTelegramPhotoUrl(url?: string): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Group complete rendered items without cutting HTML or dropping entries. */
export function buildTelegramBatches<T>(
  items: T[],
  header: string,
  footer: string,
  renderItem: (item: T) => string,
  maxChars = 3800,
  maxItems = 10,
  getPhotoUrl?: (item: T) => string | undefined,
): TelegramBatch<T>[] {
  const batches: TelegramBatch<T>[] = [];
  let batchItems: T[] = [];
  let body = '';

  const flush = () => {
    if (!batchItems.length) return;
    batches.push({ items: batchItems, text: `${header}${body}${footer}` });
    batchItems = [];
    body = '';
  };

  for (const item of items) {
    const rendered = `${renderItem(item)}\n\n`;
    const photoUrl = normalizeTelegramPhotoUrl(getPhotoUrl?.(item));
    if (photoUrl) {
      flush();
      const caption = `${header}${rendered}${footer}`;
      const captionLimit = Math.min(maxChars, 1000);
      if (caption.length > captionLimit) {
        throw new Error('Telegram item exceeds the safe message length');
      }
      batches.push({ items: [item], text: caption, photoUrl });
      continue;
    }

    const fits = header.length + body.length + rendered.length + footer.length <= maxChars;
    if (batchItems.length && (!fits || batchItems.length >= maxItems)) flush();
    if (header.length + rendered.length + footer.length > maxChars) {
      throw new Error('Telegram item exceeds the safe message length');
    }
    batchItems.push(item);
    body += rendered;
  }
  flush();
  return batches;
}
