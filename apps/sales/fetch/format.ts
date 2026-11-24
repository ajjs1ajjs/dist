const KYIV_TZ = 'Europe/Kyiv';

export function formatPrice(price: number, currency: string, locale: 'uk' | 'en' = 'uk'): string {
  if (typeof price !== 'number' || !Number.isFinite(price)) return '';
  if (price === 0) return locale === 'en' ? 'Free' : 'Безкоштовно';
  const formattedPrice = price.toLocaleString(locale === 'en' ? 'en-US' : 'uk-UA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const currencySymbol = currency === 'UAH' ? (locale === 'en' ? 'UAH' : 'грн') : currency === 'USD' ? '$' : currency;
  return `${formattedPrice} ${currencySymbol}`;
}

export function formatDate(dateStr: string, includeTime = false): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const options: Intl.DateTimeFormatOptions = {
      day: 'numeric',
      month: includeTime ? 'long' : 'short',
      year: 'numeric',
      timeZone: KYIV_TZ,
    };
    if (includeTime) {
      options.hour = '2-digit';
      options.minute = '2-digit';
    }
    const prefix = d.toLocaleDateString('uk-UA', options);
    if (includeTime) return `${prefix} (за київським часом)`;
    return prefix;
  } catch {
    return dateStr;
  }
}

export function escapeHtml(str: string): string {
  // L1: single quotes escaped too — escapeHtml is also used to build
  // single-quoted contexts, and pairing callers must not rely on luck.
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');
}

export function escapeAttr(url: string): string {
  return escapeHtml(url).replace(/"/g, '&quot;');
}

/** Matches Steam numeric AppIDs or PlayStation Store product IDs (e.g. EP0006-PPSA23566_00-BASEUFC6GAME0000). */
export function isPriceTrackedId(id: string): boolean {
  return /^\d+$/.test(id) || /^[A-Z]{2}\d{4}-[A-Z0-9_]+-[A-Z0-9_]+$/.test(id);
}

/** Compact count formatter for review totals (e.g. 12500 -> '12.5K', 1200000 -> '1.2M'). */
export function formatReviewCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return '0';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(Math.round(count));
}
