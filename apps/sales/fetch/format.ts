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
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(url: string): string {
  return escapeHtml(url).replace(/"/g, '&quot;');
}
