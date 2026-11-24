export interface TelegramInlineButton {
  text: string;
  url: string;
}

export interface TelegramReplyMarkup {
  inline_keyboard: TelegramInlineButton[][];
}

export interface TelegramBatch<T> {
  items: T[];
  text: string;
  photoUrl?: string;
  replyMarkup?: TelegramReplyMarkup;
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

/** Quiet hours in Europe/Kyiv: 23:00–07:59 send silently (`disable_notification: true`). */
export function isQuietHoursKyiv(now = new Date()): boolean {
  const hourStr = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: 'Europe/Kyiv',
  }).format(now);
  const hour = Number(hourStr) % 24;
  return hour >= 23 || hour < 8;
}

/** Group items into compact multi-item digest posts, attaching hero photo only when caption <= 1000 chars. */
export function buildDigestBatches<T>(
  items: T[],
  opts: {
    header: string;
    footer: string;
    renderItem: (item: T, index: number) => string;
    maxChars?: number;
    maxItems?: number;
    heroPhotoUrl?: string;
    replyMarkup?: TelegramReplyMarkup;
  },
): TelegramBatch<T>[] {
  const maxChars = opts.maxChars ?? 3800;
  const maxItems = opts.maxItems ?? 7;
  const batches: TelegramBatch<T>[] = [];
  let batchItems: T[] = [];
  let body = '';

  const flush = (attachHero: boolean) => {
    if (!batchItems.length) return;
    const text = `${opts.header}${body}${opts.footer}`;
    const hero = attachHero ? normalizeTelegramPhotoUrl(opts.heroPhotoUrl) : undefined;
    const canAttachHero = Boolean(hero && text.length <= 1000);
    batches.push({
      items: batchItems,
      text,
      ...(canAttachHero ? { photoUrl: hero } : {}),
      ...(opts.replyMarkup ? { replyMarkup: opts.replyMarkup } : {}),
    });
    batchItems = [];
    body = '';
  };

  items.forEach((item, index) => {
    const rendered = `${opts.renderItem(item, index)}\n\n`;
    const fits = opts.header.length + body.length + rendered.length + opts.footer.length <= maxChars;
    if (batchItems.length && (!fits || batchItems.length >= maxItems)) {
      flush(batches.length === 0);
    }
    if (opts.header.length + rendered.length + opts.footer.length > maxChars) {
      throw new Error('Telegram item exceeds the safe message length');
    }
    batchItems.push(item);
    body += rendered;
  });

  flush(batches.length === 0);
  return batches;
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
