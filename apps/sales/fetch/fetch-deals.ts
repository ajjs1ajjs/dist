import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { RateLimiter } from './rate-limiter';
import type { SteamGame, DealsData, NotifiedItem } from './types';
import { formatPrice, escapeHtml, escapeAttr } from './format';

const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'fetch-deals', runId },
});

const CONFIG = {
  dealsDir: process.env.DEALS_DIR ?? path.join(process.cwd(), 'public', 'data'),
  freeGameCooldownMs: 14 * 24 * 60 * 60 * 1000,
  discountCooldownMs: 30 * 24 * 60 * 60 * 1000,
  historyRetentionMs: 30 * 24 * 60 * 60 * 1000,
  tgMessageLimit: 4000,
  // TG-політика проти спаму: постимо лише глибокі знижки, не більше N за ран.
  // Сайт при цьому лишає всі пропозиції від 5% — ріжеться тільки нотифікація.
  tgMinDiscountPercent: 50,
  tgMaxDealsPerRun: 10,
  tgTimeoutMs: 10000,
  fetchTimeoutMs: 30000,
  fetchRetries: 3,
  fetchRetryDelayMs: 2000,
  // Покриття Steam search API: 3 сторінки по 100 = ~300 топів зі знижками.
  // Безкоштовно, без ключа; 4 запити на ран (1 categories + 3 search).
  searchPages: 3,
  searchCount: 100,
} as const;

const DEALS_DIR = CONFIG.dealsDir;
const DEALS_PATH = path.join(DEALS_DIR, 'deals.json');
const HISTORY_PATH = path.join(DEALS_DIR, 'notified-history.json');

const FREE_GAME_COOLDOWN_MS = CONFIG.freeGameCooldownMs;
const DISCOUNT_COOLDOWN_MS = CONFIG.discountCooldownMs;
const TG_MESSAGE_LIMIT = CONFIG.tgMessageLimit;

/** Strip CR/LF to prevent log forgery from upstream game titles. */
const sanitizeLog = (v: unknown): string =>
  String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, 500);

/** Finite-number coercion: Number() passes Infinity through ||0, which then
 * poisons discount math (1 - x/Inf = NaN). Clamp non-finite to the default. */
const finiteOr = (v: number, dflt: number): number =>
  Number.isFinite(v) ? v : dflt;

const STEAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Один лімітер на весь Steam (categories + search): безкоштовно, без ключа,
// ~4 запити на ран — далеко від обмежень Store API.
const steamLimiter = new RateLimiter(60);

async function fetchWithRetry(url: string, options?: RequestInit, retries = 3, delay = 2000, timeoutMs = 30000): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    let res: Response | undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const fetchOptions = { ...options, signal: controller.signal };

    try {
      res = await fetch(url, fetchOptions);
    } catch (err) {
      clearTimeout(timeout);
      logger.warn({ url: sanitizeLog(url), attempt: i + 1, retries, err: sanitizeLog(err instanceof Error ? err.message : String(err)) }, 'fetch error');
    }

    if (res) {
      clearTimeout(timeout);
      if (res.ok) return res;
      // 4xx — клієнтська помилка (404/400/403): повторювати безглуздо, перериваємо одразу.
      // 429 (Too Many Requests) — виняток: це тимчасове обмеження, повторюємо з backoff.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new Error(`Failed to fetch ${url}: non-retryable client error ${res.status}.`);
      }
      logger.warn({ url: sanitizeLog(url), status: res.status, attempt: i + 1, retries }, 'fetch failed');
    } else {
      clearTimeout(timeout);
    }

    if (i < retries - 1) {
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i))); // exponential backoff
    }
  }
  throw new Error(`Failed to fetch ${url} after ${retries} attempts.`);
}

// Minimal typings for the external API responses (res.json() is `unknown`).
interface SteamItem {
  id: number;
  name: string;
  type?: number;
  large_capsule_image?: string;
  header_image?: string;
  capsule_image?: string;
  original_price?: number;
  final_price?: number;
  discounted?: boolean;
  discount_percent?: number;
  currency?: string;
}
interface SteamCategory {
  items?: SteamItem[];
}
interface SteamResponse {
  specials?: SteamCategory;
  top_sellers?: SteamCategory;
  new_releases?: SteamCategory;
  coming_soon?: SteamCategory;
}

interface SteamSearchResponse {
  success?: number;
  total_count?: number;
  results_html?: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCharCode(Number(n));
      } catch {
        return '';
      }
    });
}

function upsertGame(
  gamesMap: Map<string, SteamGame>,
  id: string,
  title: string,
  imageUrl: string,
  originalPrice: number,
  discountPrice: number,
  discountPercent: number,
  currency: string,
  isSpecial: boolean,
  isFree: boolean,
  isPopular: boolean,
) {
  if (!title) return;
  const existing = gamesMap.get(id);
  if (existing) {
    existing.isSpecial = existing.isSpecial || isSpecial;
    existing.isFree = existing.isFree || isFree;
    existing.isPopular = existing.isPopular || isPopular;
    if (discountPercent > existing.discountPercent) {
      existing.discountPercent = discountPercent;
      existing.originalPrice = originalPrice;
      existing.discountPrice = discountPrice;
      if (imageUrl) existing.imageUrl = imageUrl;
    } else if (!existing.imageUrl && imageUrl) {
      existing.imageUrl = imageUrl;
    }
    return;
  }
  gamesMap.set(id, {
    id,
    title,
    imageUrl,
    originalPrice,
    discountPrice,
    discountPercent,
    currency: currency || 'UAH',
    url: `https://store.steampowered.com/app/${encodeURIComponent(id)}`,
    isSpecial,
    isFree,
    isPopular,
  });
}

function processCategoryItems(
  gamesMap: Map<string, SteamGame>,
  items: SteamItem[],
  opts: { specialBucket: boolean; popularBucket: boolean },
) {
  for (const item of items) {
    const id = String(item.id);
    const imageUrl = item.large_capsule_image || item.header_image || item.capsule_image || '';

    // Skip bundles, subscriptions, and non-game items
    if (imageUrl.includes('/bundles/') || imageUrl.includes('/subs/')) {
      continue;
    }
    // type 0 = game/app; skip other types (1 = DLC, 2 = demo, etc.)
    if (item.type !== undefined && item.type !== 0) {
      continue;
    }
    if (!item.name) continue;

    const originalPrice = finiteOr(Number(item.original_price ?? item.final_price ?? 0), 0) / 100;
    const discountPrice = finiteOr(Number(item.final_price ?? 0), 0) / 100;
    const pct = finiteOr(Number(item.discount_percent ?? 0), 0);
    const isFree = originalPrice > 0 && discountPrice === 0;
    // У top_sellers багато повноцінних ігор без знижки — прапорець isPopular
    // ставимо всім записам бакета, а isSpecial лише реальним знижкам.
    const isDiscounted = !isFree && pct >= 5;
    const isSpecial = opts.specialBucket ? (isDiscounted || isFree) : isDiscounted;
    const isPopular = opts.popularBucket;

    // Зі specials-бакета беремо лише реальні знижки/безкоштовне;
    // з top_sellers — усе (топи потрібні для секції трендів).
    if (opts.specialBucket && !opts.popularBucket && !isSpecial && !isFree) continue;
    if (!isSpecial && !isFree && !isPopular) continue;

    upsertGame(gamesMap, id, item.name, imageUrl, originalPrice, discountPrice, pct, item.currency || 'UAH', isSpecial, isFree, isPopular);
  }
}

async function fetchSteamCategories(gamesMap: Map<string, SteamGame>): Promise<void> {
  await steamLimiter.take();
  const url = 'https://store.steampowered.com/api/featuredcategories/?cc=UA&l=ukrainian';
  const res = await fetchWithRetry(url);
  const data = (await res.json()) as SteamResponse;

  // specials — гарячі знижки (маленький бакет ~10, тому доповнюємо search API);
  // top_sellers — топи продажів (isPopular + знижки серед них).
  processCategoryItems(gamesMap, data.specials?.items || [], { specialBucket: true, popularBucket: false });
  processCategoryItems(gamesMap, data.top_sellers?.items || [], { specialBucket: false, popularBucket: true });
  logger.info(
    {
      specials: data.specials?.items?.length ?? 0,
      topSellers: data.top_sellers?.items?.length ?? 0,
    },
    'steam categories fetched',
  );
}

/** Парсинг однієї сторінки search API (topsellers + specials). */
function parseSearchHtml(html: string, gamesMap: Map<string, SteamGame>): number {
  const anchorRe = /<a\b[^>]*data-ds-appid="(\d+)"[^>]*data-ds-itemkey="([^"]*)"[^>]*>([\s\S]*?)<\/a\s*>/g;
  let added = 0;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const appId = m[1];
    const itemKey = m[2] || '';
    // Тільки застосунки; Bundle/Package/Sub пропускаємо (ціни там за набір).
    if (!itemKey.startsWith('App_')) continue;
    const body = m[3];

    const titleM = body.match(/<span class="title">(.*?)<\/span>/s);
    const imgM = body.match(/<img\s+src="([^"]+)"/);
    const pctM = body.match(/<div class="discount_pct">\s*-(\d+)%\s*<\/div>/);
    const finalM = body.match(/data-price-final="(\d+)"/);
    if (!titleM || !pctM || !finalM) continue;

    const discountPercent = finiteOr(Number(pctM[1]), 0);
    const finalCents = finiteOr(Number(finalM[1]), NaN);
    if (!Number.isFinite(finalCents)) continue;
    const discountPrice = finalCents / 100;
    const originalPrice =
      discountPercent > 0 && discountPercent < 100
        ? Math.round((discountPrice / (1 - discountPercent / 100)) * 100) / 100
        : discountPrice;
    const isFree = discountPercent >= 100 || (originalPrice > 0 && discountPrice === 0);
    const isSpecial = !isFree && discountPercent >= 5;

    if (!isSpecial && !isFree) continue;

    const title = decodeEntities(titleM[1].trim()).slice(0, 300);
    let imageUrl = imgM ? imgM[1] : '';
    try {
      // Прибираємо query для стабільності кешу, лишаємо шлях до капсули.
      const u = new URL(imageUrl);
      imageUrl = `${u.origin}${u.pathname}`;
    } catch {
      /* лишаємо як є */
    }

    upsertGame(gamesMap, appId, title, imageUrl, originalPrice, discountPrice, isFree ? 100 : discountPercent, 'UAH', isSpecial, isFree, true);
    added++;
  }
  return added;
}

async function fetchSteamSearchDeals(gamesMap: Map<string, SteamGame>): Promise<void> {
  for (let page = 0; page < CONFIG.searchPages; page++) {
    const start = page * CONFIG.searchCount;
    await steamLimiter.take();
    const url =
      `https://store.steampowered.com/search/results/?query&start=${start}` +
      `&count=${CONFIG.searchCount}&dynamic_data=&sort_by=_ASC&snr=1_7_7_230_7&infinite=1` +
      `&filter=topsellers&specials=1&cc=UA&l=ukrainian`;
    const res = await fetchWithRetry(
      url,
      { headers: { 'User-Agent': STEAM_UA, Accept: 'application/json' } },
    );
    const data = (await res.json()) as SteamSearchResponse;
    if (!data.success || typeof data.results_html !== 'string') {
      logger.warn({ page, start }, 'steam search page failed (no success/html)');
      continue;
    }
    const added = parseSearchHtml(data.results_html, gamesMap);
    logger.info({ page, start, total: data.total_count ?? -1, added }, 'steam search page fetched');
    // Остання неповна сторінка — далі гортати нема чого.
    if (data.results_html.length < 1000) break;
  }
}

async function fetchSteamGames(): Promise<SteamGame[]> {
  logger.info('Fetching Steam: categories + topsellers search...');
  const gamesMap = new Map<string, SteamGame>();

  await fetchSteamCategories(gamesMap);
  await fetchSteamSearchDeals(gamesMap);

  return Array.from(gamesMap.values());
}

async function sendTelegramMessage(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    logger.info('⚠️ Telegram credentials not found (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID). Skipping notification.');
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const logSafeUrl = 'https://api.telegram.org/bot[REDACTED]/sendMessage';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.tgTimeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: false
      }),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeout);
    const message = err instanceof Error ? err.message : String(err);
    const sanitized = message.split(token).join('[REDACTED]');
    logger.error({ url: logSafeUrl, err: sanitized }, 'telegram api network error');
    throw new Error(`Telegram send failed: ${sanitized}`, { cause: err });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    logger.error({ url: logSafeUrl, status: response.status }, 'telegram api error');
  } else {
    logger.info('✅ Telegram message sent successfully.');
  }
}

async function run() {
  logger.info('Starting deals fetcher script (Steam-only)...');

  // Load previous deals for comparison.
  // Поле `epic` зі старих файлів ігнорується (перехід на Steam-only):
  // відсутнє чи пошкоджене поле не повинно класти ран.
  const coerceOldData = (parsed: unknown): DealsData => {
    const p = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    return {
      lastUpdated: typeof p.lastUpdated === 'string' ? p.lastUpdated : '',
      steam: Array.isArray(p.steam) ? (p.steam as DealsData['steam']) : [],
      notifiedHistory: {},
    };
  };

  let oldData: DealsData = { lastUpdated: '', steam: [], notifiedHistory: {} };
  if (fs.existsSync(DEALS_PATH)) {
    try {
      oldData = coerceOldData(JSON.parse(fs.readFileSync(DEALS_PATH, 'utf-8')));
      logger.info('Loaded previous deals from local path.');
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'failed to parse old local deals.json');
    }
  } else {
    try {
      const githubPagesUrl = `https://ajjs1ajjs.github.io/dist/sales/data/deals.json`;
      logger.info(`Trying to fetch previous deals from GitHub Pages: ${githubPagesUrl}`);
      const res = await fetch(githubPagesUrl);
      if (res.ok) {
        oldData = coerceOldData(await res.json());
        logger.info('✅ Loaded previous deals from GitHub Pages.');
      }
    } catch {
      logger.info('⚠️ Could not fetch from GitHub Pages, starting fresh.');
    }
  }

  // Load notified history from separate file (append-only, merge-friendly).
  // Coerced entry-by-entry like deals.json: a malformed value (null, array,
  // bad timestamp) is dropped instead of crashing the run later.
  let notifiedHistory: Record<string, NotifiedItem> = {};
  const coerceHistory = (parsed: unknown): Record<string, NotifiedItem> => {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, NotifiedItem> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const item = v as Record<string, unknown>;
      if (typeof item.timestamp !== 'string' || Number.isNaN(new Date(item.timestamp).getTime())) continue;
      if (typeof item.type !== 'string' || typeof item.title !== 'string') continue;
      // Старі epic-ключі чистимо: джерела більше нема, історію не тягнемо.
      if (k.startsWith('epic_')) continue;
      out[k] = item as unknown as NotifiedItem;
    }
    return out;
  };
  if (fs.existsSync(HISTORY_PATH)) {
    try {
      notifiedHistory = coerceHistory(JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8')));
      logger.info('Loaded notified history from local path.');
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'failed to parse notified-history.json');
    }
  } else {
    try {
      const githubPagesHistoryUrl = `https://ajjs1ajjs.github.io/dist/sales/data/notified-history.json`;
      logger.info(`Trying to fetch notified history from GitHub Pages: ${githubPagesHistoryUrl}`);
      const res = await fetch(githubPagesHistoryUrl);
      if (res.ok) {
        notifiedHistory = coerceHistory(await res.json());
        logger.info('✅ Loaded notified history from GitHub Pages.');
      }
    } catch {
      logger.info('⚠️ Could not fetch notified history from GitHub Pages, starting fresh.');
    }
  }

  // Clean notified history: remove expired (30 days) and corrupted (NaN timestamp) entries
  const now = new Date();
  const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;

  for (const [key, value] of Object.entries(notifiedHistory)) {
    const notifiedTime = new Date(value.timestamp).getTime();
    // Видаляємо застарілі ТА пошкоджені (невалідна дата → NaN) записи,
    // інакше биті записи накопичувалися б вічно (NaN < x === false).
    if (Number.isNaN(notifiedTime) || notifiedTime < thirtyDaysAgo) {
      delete notifiedHistory[key];
    }
  }

  // Fetch fresh data (Steam-only)
  let steamFetchSuccess = false;

  const freshSteam = await fetchSteamGames().then(r => { steamFetchSuccess = true; return r; }).catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'steam fetch failed');
    return [] as SteamGame[];
  });

  // Guard against API/scraping failure:
  // If fetch failed (not just empty) but we had games previously, abort to prevent data deletion.
  if (!steamFetchSuccess && oldData.steam.length > 0) {
    throw new Error('Steam games fetch failed, but previous data was not empty. Aborting to prevent data deletion.');
  }
  // If fetch succeeded but returned empty, log warning but continue (could be legitimate no deals)
  if (steamFetchSuccess && freshSteam.length === 0 && oldData.steam.length > 0) {
    logger.warn('⚠️ Steam fetch succeeded but returned empty list. Previous data had games. Keeping old data.');
  }

  // Detect changes
  const newSteamFreeGames: SteamGame[] = [];
  let newSteamDeals: SteamGame[] = [];

  // Steam: Find new items
  for (const game of freshSteam) {
    if (game.isFree) {
      const historyKey = `steam_free_${game.id}`;
      const historyEntry = notifiedHistory[historyKey];
      const cooldownExpired = !historyEntry || now.getTime() - new Date(historyEntry.timestamp).getTime() > FREE_GAME_COOLDOWN_MS;
      if (cooldownExpired) {
        newSteamFreeGames.push(game);
      }
    }

    // TG: лише глибокі знижки (від tgMinDiscountPercent). Сайт показує всі від 5%.
    if (game.isSpecial && game.discountPercent >= CONFIG.tgMinDiscountPercent) {
      const historyKey = `steam_discount_${game.id}`;
      const historyEntry = notifiedHistory[historyKey];

      let shouldNotify = false;
      if (!historyEntry) {
        shouldNotify = true;
      } else {
        const lastNotified = new Date(historyEntry.timestamp).getTime();
        // Повторно постимо лише за значущого здешевлення (≥5% дешевше за
        // останню запощену ціну) або після 30-денного кулдауну. Порівняння
        // "будь-яка копійка нижче" спамило канал на округленнях/флуктуаціях Steam.
        const priceDropped = game.discountPrice < historyEntry.price * 0.95;
        const cooldownExpired = now.getTime() - lastNotified > DISCOUNT_COOLDOWN_MS;
        if (priceDropped || cooldownExpired) {
          shouldNotify = true;
        }
      }

      if (shouldNotify) {
        newSteamDeals.push(game);
      }
    }

  }

  // Кап проти заливки каналу (розпродажі Steam рухають сотні цін за раз):
  // беремо топ за відсотком, решта мовчки лишається на сайті.
  newSteamDeals.sort(
    (a, b) => b.discountPercent - a.discountPercent || (b.originalPrice - b.discountPrice) - (a.originalPrice - a.discountPrice),
  );
  if (newSteamDeals.length > CONFIG.tgMaxDealsPerRun) {
    logger.info(
      { total: newSteamDeals.length, capped: CONFIG.tgMaxDealsPerRun },
      'capping telegram deals to top by discount percent',
    );
    newSteamDeals = newSteamDeals.slice(0, CONFIG.tgMaxDealsPerRun);
  }

  logger.info(`Detected: ${newSteamFreeGames.length} free Steam, ${newSteamDeals.length} hot Steam (total ${freshSteam.length}).`);

  function markNotified(key: string, entry: NotifiedItem) {
    notifiedHistory[key] = entry;
  }

  // Shared Telegram-HTML builders to keep the notification blocks DRY.
  const gameTitle = (name: string) => `<b>${escapeHtml(name)}</b>`;
  const storeLink = (label: string, url: string) => `<a href="${escapeAttr(url)}">${label}</a>`;

  function formatDealLine(
    title: string,
    percent: number,
    originalPrice: number,
    discountPrice: number,
    currency: string,
    url: string,
    linkLabel: string,
  ): string {
    const pct = percent > 0 ? `-${percent}%` : 'знижка';
    return `🎮 ${gameTitle(title)}\n🏷️ Знижка: <b>${pct}</b>\n💰 Ціна: <s>${formatPrice(originalPrice, currency)}</s> ➡️ <b>${formatPrice(discountPrice, currency)}</b>\n🔗 ${storeLink(linkLabel, url)}`;
  }

  // Helper: split array of items into batches and send each as Telegram message.
  // Calls markSent(index) after each successful batch to prevent duplicate
  // notifications on the next cron run if a later batch fails.
  async function sendBatched<T>(
    header: string,
    items: T[],
    footer: string,
    buildItem: (item: T) => string,
    markSent: (index: number) => void,
  ) {
    const batchSize = 10;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      let text = header;
      for (const item of batch) {
        text += buildItem(item) + '\n\n';
      }
      text += footer;
      await sendTelegramMessage(text.slice(0, TG_MESSAGE_LIMIT));
      for (let j = 0; j < batch.length; j++) {
        markSent(i + j);
      }
    }
  }

  if (newSteamDeals.length > 0) {
    await sendBatched(
      `🔥 <b>ГАРЯЧІ ЗНИЖКИ В STEAM (від 50%)!</b>\n\n`,
      newSteamDeals,
      `🚀 Більше знижок дивіться на нашому сайті!`,
      (deal) => formatDealLine(deal.title, deal.discountPercent, deal.originalPrice, deal.discountPrice, deal.currency, deal.url, 'Детальніше в Steam'),
      (i) => markNotified(`steam_discount_${newSteamDeals[i].id}`, {
        title: newSteamDeals[i].title, price: newSteamDeals[i].discountPrice, percent: newSteamDeals[i].discountPercent, timestamp: now.toISOString(), type: 'discount'
      }),
    );
  }

  if (newSteamFreeGames.length > 0) {
    await sendBatched(
      `🎁 <b>БЕЗКОШТОВНІ ПРОПОЗИЦІЇ В STEAM!</b>\n\n`,
      newSteamFreeGames,
      `🚀 Інші пропозиції дивіться на нашому сайті!`,
      (game) => `🎮 ${gameTitle(game.title)}\n💰 <b>БЕЗКОШТОВНО</b>\n🔗 ${storeLink('Забрати в Steam', game.url)}`,
      (i) => markNotified(`steam_free_${newSteamFreeGames[i].id}`, {
        title: newSteamFreeGames[i].title, price: 0, percent: 100, timestamp: now.toISOString(), type: 'free'
      }),
    );
  }

  // Save updated data (Steam-only; поле epic видалено)
  const newData: DealsData = {
    lastUpdated: new Date().toISOString(),
    steam: freshSteam,
    notifiedHistory: {}
  };

  await fs.promises.mkdir(DEALS_DIR, { recursive: true });
  await fs.promises.writeFile(DEALS_PATH, JSON.stringify(newData, null, 2), 'utf-8');
  logger.info(`✅ Saved new data to ${DEALS_PATH}`);

  // Save notified history to separate file (atomic write via temp file)
  const historyTmpPath = `${HISTORY_PATH}.tmp`;
  await fs.promises.writeFile(historyTmpPath, JSON.stringify(notifiedHistory, null, 2), 'utf-8');
  await fs.promises.rename(historyTmpPath, HISTORY_PATH);
  logger.info(`✅ Saved notified history to ${HISTORY_PATH}`);
}

let shuttingDown = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.warn({ sig }, 'received shutdown signal, exiting');
    process.exit(143);
  });
}

run().catch(err => {
  logger.error({ err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err) }, 'critical error running fetcher');
  process.exit(1);
});
