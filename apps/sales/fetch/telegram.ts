export interface TelegramBatch<T> {
  items: T[];
  text: string;
}

/** Group complete rendered items without cutting HTML or dropping entries. */
export function buildTelegramBatches<T>(
  items: T[],
  header: string,
  footer: string,
  renderItem: (item: T) => string,
  maxChars = 3800,
  maxItems = 10,
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
