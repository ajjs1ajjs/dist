import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { fileURLToPath } from 'node:url';
import { RateLimiter } from './rate-limiter';
import { chooseSteamSnapshot, isValidSteamSearchPage, planGamePassNewEntries } from './collector-core';
import { writeJsonAtomically } from './persistence';
import { buildTelegramBatches } from './telegram';
import {
  claimNextMessage, classifyDeliveryFailure, emptyOutbox, enqueueMessage, normalizeOutbox, pendingReceiptKeys,
  pruneDelivered, recordDeliveryOutcome,
} from './outbox';
import type { NotificationOutbox, OutboxReceipt } from './outbox';
import type { SteamGame, GamePassGame, DealsData, NotifiedItem } from './types';
import { formatPrice, escapeHtml, escapeAttr } from './format';

const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'fetch-deals', runId },
});

const CONFIG = {
  dealsDir: process.env.DEALS_DIR ?? path.resolve(process.cwd(), '../../../sales/data'),
  freeGameCooldownMs: 14 * 24 * 60 * 60 * 1000,
  discountCooldownMs: 30 * 24 * 60 * 60 * 1000,
  historyRetentionMs: 30 * 24 * 60 * 60 * 1000,
  tgMessageLimit: 4000,
  // Порог знижки — однаковий для сайту і Telegram (вимога власника: правила
  // сайту й каналу мають збігатися). Сайт показує знижки від 25%, глибші —
  // ще й постить у канал (з анти-спам капом і кулдаунами нижче).
  minDiscountPercent: 25,
  tgMaxDealsPerRun: 10,
  tgTimeoutMs: 10000,
  fetchTimeoutMs: 30000,
  fetchRetries: 3,
  fetchRetryDelayMs: 2000,
  // Покриття Steam search API: 3 сторінки по 100 = ~300 топів зі знижками.
  // Безкоштовно, без ключа; 4 запити на ран (1 categories + 3 search).
  searchPages: 3,
  searchCount: 100,
  // Game Pass для ПК: неофіційний каталог catalog.gamepass.com (списки
  // «Recently added» / «Most popular», як на xbox.com) + displaycatalog
  // для назв/зображень. Без ключа; ~5 запитів на ран.
  gamepass: {
    market: 'UA',
    language: 'uk-ua',
    /** BigId підписки Game Pass Ultimate (cfq7ttc0khs0 на xbox.com). */
    subscriptionUltimate: 'cfq7ttc0khs0',
    /** Sigl-колекції xbox.com: PC «Recently added» та «Most popular». */
    siglNew: '06323672-b8c8-43cc-b0de-32d5a9834749',
    siglPopular: 'a884932a-f02b-40c8-a903-a008c23b1df1',
    detailsBatchSize: 20,
    // Ключі gamepass_ живуть довше за 30 днів: інакше гра, що тижнями
    // висить у «Recently added», після очистки сповістилася б повторно.
    historyRetentionMs: 120 * 24 * 60 * 60 * 1000,
  },
} as const;

const DEALS_DIR = CONFIG.dealsDir;
const DEALS_PATH = path.join(DEALS_DIR, 'deals.json');
const HISTORY_PATH = path.join(DEALS_DIR, 'notified-history.json');
const OUTBOX_PATH = path.join(DEALS_DIR, 'notification-outbox.json');

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

// Microsoft-каталог: ~5 запитів на ран (2 списки + батчі деталей).
const gamepassLimiter = new RateLimiter(30);

export async function fetchWithRetry(url: string, options?: RequestInit, retries = 3, delay = 2000, timeoutMs = 30000): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    let res: Response | undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const fetchOptions = { ...options, signal: controller.signal };

    try {
      res = await fetch(url, fetchOptions);
      if (res.ok) {
        // Keep the request deadline active through body download. Returning the
        // original Response after clearing the timer left .json() unbounded.
        const body = await res.arrayBuffer();
        res = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
      } else {
        await res.body?.cancel();
      }
    } catch (err) {
      res = undefined;
      logger.warn({ url: sanitizeLog(url), attempt: i + 1, retries, err: sanitizeLog(err instanceof Error ? err.message : String(err)) }, 'fetch error');
    } finally {
      clearTimeout(timeout);
    }

    if (res) {
      if (res.ok) return res;
      // 4xx — клієнтська помилка (404/400/403): повторювати безглуздо, перериваємо одразу.
      // 429 (Too Many Requests) — виняток: це тимчасове обмеження, повторюємо з backoff.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new Error(`Failed to fetch ${url}: non-retryable client error ${res.status}.`);
      }
      logger.warn({ url: sanitizeLog(url), status: res.status, attempt: i + 1, retries }, 'fetch failed');
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

// Minimal typings for catalog.gamepass.com / displaycatalog responses.
interface GamePassCatalogEntry {
  id?: string;
}
interface GamePassImage {
  ImagePurpose?: string;
  Uri?: string;
}
interface GamePassLocalizedProperty {
  Language?: string;
  ProductTitle?: string;
  ProductDescription?: string;
  Images?: GamePassImage[];
}
interface GamePassProduct {
  ProductId?: string;
  LocalizedProperties?: GamePassLocalizedProperty[];
}
interface GamePassDetailsResponse {
  Products?: GamePassProduct[];
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

export function processCategoryItems(
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

    // A missing final_price is unknown data, not a free offer.
    if (!Number.isFinite(item.final_price)) continue;
    const originalPrice = finiteOr(Number(item.original_price ?? item.final_price), NaN) / 100;
    const discountPrice = finiteOr(Number(item.final_price), NaN) / 100;
    if (!Number.isFinite(originalPrice) || !Number.isFinite(discountPrice) || originalPrice < 0 || discountPrice < 0) continue;
    const pct = finiteOr(Number(item.discount_percent ?? 0), 0);
    const isFree = originalPrice > 0 && discountPrice === 0;
    // У top_sellers багато повноцінних ігор без знижки — прапорець isPopular
    // ставимо всім записам бакета, а isSpecial лише реальним знижкам.
    const isDiscounted = !isFree && pct >= CONFIG.minDiscountPercent;
    // Free offers are surfaced through their own (free) section/post. They must
    // not also be flagged as "specials": a free game in the specials bucket used
    // to get isSpecial=true, which posted it twice (free + a bogus -100% deal).
    const isSpecial = isDiscounted;
    const isPopular = opts.popularBucket;

    // Зі specials-бакета беремо лише знижки від порога/безкоштовне;
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
export function parseSearchHtml(html: string, gamesMap: Map<string, SteamGame>): number {
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
    const isSpecial = !isFree && discountPercent >= CONFIG.minDiscountPercent;

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
    if (!isValidSteamSearchPage(data)) {
      throw new Error(`Steam search page ${page} returned an incomplete response.`);
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

/** Порядок переваги зображень каталогу (усі landscape або близькі до 16:9). */
const GAMEPASS_IMAGE_PRIORITY = ['TitledHeroArt', 'SuperHeroArt', 'FeaturePromotionalSquareArt', 'BoxArt', 'Poster'] as const;

/** Protocol-relative URI (`//store-images...`) → https — safeUrl у UI такі відкидає. */
function toHttpsUri(uri: string): string {
  return uri.startsWith('//') ? `https:${uri}` : uri;
}

/** Slug у шляху xbox.com довільний (реальний slug підставляє сам сайт), тому робимо з назви. */
function gamepassProductUrl(id: string, title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'game';
  return `https://www.xbox.com/uk-UA/games/store/${slug}/${id}`;
}

function pickGamePassTitle(product: GamePassProduct): string {
  const localized = product.LocalizedProperties ?? [];
  const uk = localized.find((l) => typeof l.Language === 'string' && l.Language.toLowerCase().startsWith('uk'));
  const title = (uk ?? localized[0])?.ProductTitle;
  return typeof title === 'string' ? title.trim().slice(0, 300) : '';
}

function pickGamePassDescription(product: GamePassProduct): string {
  const localized = product.LocalizedProperties ?? [];
  const uk = localized.find((l) => typeof l.Language === 'string' && l.Language.toLowerCase().startsWith('uk'));
  const description = (uk ?? localized[0])?.ProductDescription;
  // Один рядок без переносів — інакше TG-пост «пливе».
  return typeof description === 'string' ? description.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}

function pickGamePassImage(product: GamePassProduct): string {
  const images = (product.LocalizedProperties ?? []).flatMap((l) => l.Images ?? []);
  for (const purpose of GAMEPASS_IMAGE_PRIORITY) {
    const image = images.find((i) => i.ImagePurpose === purpose && typeof i.Uri === 'string' && i.Uri.length > 0);
    if (image && image.Uri) return toHttpsUri(image.Uri);
  }
  const any = images.find((i) => typeof i.Uri === 'string' && i.Uri.length > 0);
  return any && any.Uri ? toHttpsUri(any.Uri) : '';
}

/** Id з sigl-колекції Game Pass (перший елемент відповіді — заголовок колекції). */
async function fetchGamePassIds(siglId: string): Promise<string[]> {
  await gamepassLimiter.take();
  const url =
    `https://catalog.gamepass.com/sigls/v3?id=${siglId}` +
    `&language=${CONFIG.gamepass.language}&market=${CONFIG.gamepass.market}` +
    `&platformContext=pc&subscriptionContext=${CONFIG.gamepass.subscriptionUltimate}`;
  const res = await fetchWithRetry(url, { headers: { 'User-Agent': STEAM_UA, Accept: 'application/json' } });
  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    logger.warn({ siglId }, 'gamepass sigl response is not an array');
    return [];
  }

  const ids: string[] = [];
  for (const entry of data as GamePassCatalogEntry[]) {
    const id = typeof entry?.id === 'string' ? entry.id.trim().toUpperCase() : '';
    if (/^[A-Z0-9]{8,20}$/.test(id)) ids.push(id);
  }
  logger.info({ siglId, count: ids.length }, 'gamepass list fetched');
  return [...new Set(ids)];
}

/** Деталі продуктів (назва/опис/зображення) батчами через displaycatalog. */
async function fetchGamePassDetails(ids: string[]): Promise<Map<string, { title: string; description: string; imageUrl: string }>> {
  const details = new Map<string, { title: string; description: string; imageUrl: string }>();
  for (let i = 0; i < ids.length; i += CONFIG.gamepass.detailsBatchSize) {
    const batch = ids.slice(i, i + CONFIG.gamepass.detailsBatchSize);
    try {
      await gamepassLimiter.take();
      const url =
        `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${batch.join(',')}` +
        `&market=${CONFIG.gamepass.market}&languages=${CONFIG.gamepass.language}`;
      const res = await fetchWithRetry(url, { headers: { 'User-Agent': STEAM_UA, Accept: 'application/json' } });
      const data = (await res.json()) as GamePassDetailsResponse;
      for (const product of data.Products ?? []) {
        const id = typeof product.ProductId === 'string' ? product.ProductId.trim().toUpperCase() : '';
        const title = pickGamePassTitle(product);
        if (!id || !title) continue;
        details.set(id, { title, description: pickGamePassDescription(product), imageUrl: pickGamePassImage(product) });
      }
    } catch (err) {
      // Частковий збій батча не має валити весь каталог — решта батчів іде далі.
      logger.warn({ offset: i, err: err instanceof Error ? err.message : String(err) }, 'gamepass details batch failed');
    }
  }
  return details;
}

async function fetchGamePassGames(): Promise<GamePassGame[]> {
  logger.info('Fetching Game Pass for PC: recently added + most popular...');
  const [newIds, popularIds] = await Promise.all([
    fetchGamePassIds(CONFIG.gamepass.siglNew),
    fetchGamePassIds(CONFIG.gamepass.siglPopular),
  ]);

  const flags = new Map<string, { isNew: boolean; isPopular: boolean }>();
  for (const id of newIds) flags.set(id, { isNew: true, isPopular: false });
  for (const id of popularIds) {
    const entry = flags.get(id) ?? { isNew: false, isPopular: false };
    entry.isPopular = true;
    flags.set(id, entry);
  }

  const ids = [...flags.keys()];
  const details = await fetchGamePassDetails(ids);
  // A missing detail can mean a transient/partial catalogue response. Keep the
  // previously published snapshot rather than advancing a partial one.
  if (details.size < ids.length) {
    throw new Error(`gamepass details resolved only ${details.size}/${ids.length}`);
  }

  const games: GamePassGame[] = [];
  for (const [id, flag] of flags) {
    const detail = details.get(id);
    if (!detail) continue; // без назви картка марна — краще пропустити
    games.push({
      id,
      title: detail.title,
      imageUrl: detail.imageUrl,
      url: gamepassProductUrl(id, detail.title),
      description: detail.description,
      isNew: flag.isNew,
      isPopular: flag.isPopular,
    });
  }
  logger.info(
    { total: games.length, recentlyAdded: newIds.length, mostPopular: popularIds.length },
    'gamepass catalog fetched',
  );
  return games;
}

async function sendTelegramMessage(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    logger.info('⚠️ Telegram credentials not found (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID). Skipping notification.');
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const logSafeUrl = 'https://api.telegram.org/bot[REDACTED]/sendMessage';

  // Each outbox claim gets one HTTP request. If the response is lost, retrying
  // inside this helper could duplicate a Telegram post before Git records an
  // outcome; the caller marks that case uncertain for operator review.
  const attempts = 1;
  let response: Response | undefined;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.tgTimeoutMs);
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
      break;
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      const sanitized = message.split(token).join('[REDACTED]');
      logger.warn({ url: logSafeUrl, attempt, attempts, err: sanitized }, 'telegram api network error');
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!response) {
    const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
    const sanitized = message.split(token).join('[REDACTED]');
    throw new Error(`Telegram send failed: ${sanitized}`, { cause: lastErr });
  }

  if (!response.ok) {
    // M1: тихий пропуск гірший за падіння рану — невідправлене маркувалось
    // sent і чекало кулдауну 30 днів. Кидаємо зі статусом: викликач вирішує
    // (429/5xx — перервати ран і повторити наступного разу; решта 4xx —
    // перманентно, маркувати щоб не отруїти чергу).
    logger.error({ url: logSafeUrl, status: response.status }, 'telegram api error');
    const err = new Error(`Telegram send failed: HTTP ${response.status}`);
    (err as NodeJS.ErrnoException).code = `HTTP_${response.status}`;
    throw err;
  }
  logger.info('✅ Telegram message sent successfully.');
  return true;
}

function readNotificationOutbox(): NotificationOutbox {
  if (!fs.existsSync(OUTBOX_PATH)) return emptyOutbox();
  return normalizeOutbox(JSON.parse(fs.readFileSync(OUTBOX_PATH, 'utf-8')));
}

async function persistDeliveredReceipts(receipts: OutboxReceipt[]) {
  let history: Record<string, NotifiedItem> = {};
  if (fs.existsSync(HISTORY_PATH)) {
    const parsed: unknown = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid notified history file');
    history = parsed as Record<string, NotifiedItem>;
  }
  for (const receipt of receipts) history[receipt.key] = receipt.entry;
  await writeJsonAtomically(HISTORY_PATH, history);

  if (fs.existsSync(DEALS_PATH)) {
    const deals = JSON.parse(fs.readFileSync(DEALS_PATH, 'utf-8')) as DealsData;
    if (!deals || typeof deals !== 'object' || !Array.isArray(deals.steam)) throw new Error('Invalid deals snapshot');
    deals.notifiedHistory = history;
    await writeJsonAtomically(DEALS_PATH, deals);
  }
}

async function runOutboxCommand(args: string[]) {
  const command = args[0];
  const outbox = readNotificationOutbox();

  if (command === '--claim-next') {
    const message = claimNextMessage(outbox);
    await writeJsonAtomically(OUTBOX_PATH, outbox);
    if (message) console.log(`CLAIMED ${message.id}`);
    else console.log('NO_PENDING');
    return;
  }

  if (command === '--send-claimed') {
    const message = outbox.messages.find(item => item.status === 'sending');
    if (!message) { console.log('NO_CLAIM'); return; }

    let outcome: Parameters<typeof recordDeliveryOutcome>[2];
    let delivered = false;
    try {
      delivered = await sendTelegramMessage(message.text);
      outcome = delivered
        ? { kind: 'delivered' }
        : { kind: 'blocked', error: 'Telegram credentials are missing.' };
    } catch (err) {
      const error = sanitizeLog(err instanceof Error ? err.message : String(err));
      outcome = classifyDeliveryFailure((err as NodeJS.ErrnoException).code, error);
    }

    if (delivered) await persistDeliveredReceipts(message.receipts);
    recordDeliveryOutcome(outbox, message.id, outcome);
    await writeJsonAtomically(OUTBOX_PATH, outbox);
    console.log(`${outcome.kind.toUpperCase()} ${message.id}`);
    return;
  }

  if (command === '--resolve') {
    const [, id, resolution] = args;
    const message = outbox.messages.find(item => item.id === id);
    if (!message || !['uncertain', 'blocked'].includes(message.status)) {
      throw new Error(`Message is not awaiting operator resolution: ${id}`);
    }
    if (resolution === 'delivered') {
      await persistDeliveredReceipts(message.receipts);
      message.status = 'delivered';
      delete message.lastError;
    } else if (resolution === 'pending') {
      message.status = 'pending';
      delete message.claimedAt;
      delete message.nextAttemptAt;
      delete message.lastError;
    } else {
      throw new Error('Resolution must be delivered or pending');
    }
    await writeJsonAtomically(OUTBOX_PATH, outbox);
    console.log(`RESOLVED ${id} ${resolution}`);
    return;
  }

  if (command === '--list-outbox') {
    for (const message of outbox.messages) {
      console.log(`${message.id}\t${message.status}\t${message.receipts.map(receipt => receipt.key).join(',')}`);
    }
    return;
  }

  throw new Error(`Unknown fetcher command: ${command}`);
}

const HISTORY_REMOTE_URL = 'https://ajjs1ajjs.github.io/dist/sales/data/notified-history.json';

type HistoryLogger = {
  info: (msg: string) => void;
  error: (obj: unknown, msg: string) => void;
};

/** Keep only well-formed history entries; drop legacy epic_* keys. */
export function coerceHistory(parsed: unknown): Record<string, NotifiedItem> {
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
}

export interface HistorySource {
  readLocal: () => string | undefined;
  readRemote: () => Promise<unknown | undefined>;
}

/**
 * Load the notification history without ever turning a corrupt file into an
 * empty one. An unreadable local file is recovered from the published copy; if
 * that also fails the run is aborted, because "history unreadable" must not be
 * treated as "nothing was ever notified" — that would re-send the whole catalog.
 */
export async function loadNotifiedHistory(
  source: HistorySource,
  log: HistoryLogger,
): Promise<Record<string, NotifiedItem>> {
  const localRaw = source.readLocal();
  if (localRaw !== undefined) {
    try {
      const history = coerceHistory(JSON.parse(localRaw));
      log.info('Loaded notified history from local path.');
      return history;
    } catch (err) {
      log.error(
        { err: err instanceof Error ? err.message : String(err) },
        'failed to parse local notified-history.json; attempting remote recovery',
      );
    }
  }

  let remote: unknown | undefined;
  try {
    remote = await source.readRemote();
  } catch {
    log.info('⚠️ Could not fetch remote notified history.');
  }
  if (remote !== undefined) {
    log.info('✅ Loaded notified history from GitHub Pages.');
    return coerceHistory(remote);
  }

  if (localRaw !== undefined) {
    throw new Error(
      'notified-history.json is corrupt and no remote copy is available; refusing to run to avoid mass re-notification',
    );
  }

  log.info('⚠️ Could not fetch notified history from GitHub Pages, starting fresh.');
  return {};
}

async function runPrepare() {
  logger.info('Starting deals fetcher script (Steam + Game Pass PC)...');

  // Load previous deals for comparison.
  // Поле `epic` зі старих файлів ігнорується (перехід на Steam-only):
  // відсутнє чи пошкоджене поле не повинно класти ран.
  const coerceOldData = (parsed: unknown): DealsData => {
    const p = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    return {
      lastUpdated: typeof p.lastUpdated === 'string' ? p.lastUpdated : '',
      steam: Array.isArray(p.steam) ? (p.steam as DealsData['steam']) : [],
      gamepass: Array.isArray(p.gamepass) ? (p.gamepass as GamePassGame[]) : [],
      notifiedHistory: {},
    };
  };

  let oldData: DealsData = { lastUpdated: '', steam: [], gamepass: [], notifiedHistory: {} };
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

  // Load notified history from the separate file (append-only, merge-friendly).
  // A corrupt local file must NOT be read as "nothing was ever notified": that
  // would reset every cooldown and re-send the whole catalog. Recover from the
  // published copy, or stop the run when neither source is readable.
  const notifiedHistory = await loadNotifiedHistory(
    {
      readLocal: () =>
        fs.existsSync(HISTORY_PATH) ? fs.readFileSync(HISTORY_PATH, 'utf-8') : undefined,
      readRemote: async () => {
        const res = await fetch(HISTORY_REMOTE_URL);
        return res.ok ? await res.json() : undefined;
      },
    },
    logger,
  );

  // Clean notified history: remove expired (30 days) and corrupted (NaN timestamp) entries
  const now = new Date();

  for (const [key, value] of Object.entries(notifiedHistory)) {
    const notifiedTime = new Date(value.timestamp).getTime();
    // Видаляємо застарілі ТА пошкоджені (невалідна дата → NaN) записи,
    // інакше биті записи накопичувалися б вічно (NaN < x === false).
    // Game Pass-ключі тримаємо довше (див. CONFIG.gamepass): запис, що
    // зник із файлу, поки гра ще висить у «Recently added», дав би дубль.
    const maxAgeMs = key.startsWith('gamepass_') ? CONFIG.gamepass.historyRetentionMs : CONFIG.historyRetentionMs;
    if (Number.isNaN(notifiedTime) || notifiedTime < now.getTime() - maxAgeMs) {
      delete notifiedHistory[key];
    }
  }

  function markNotified(key: string, entry: NotifiedItem) {
    notifiedHistory[key] = entry;
  }

  // Fetch fresh data (Steam-only)
  let steamFetchSuccess = false;

  const freshSteam = await fetchSteamGames().then(r => { steamFetchSuccess = true; return r; }).catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'steam fetch failed');
    return [] as SteamGame[];
  });

  // Keep the last known-good catalog on failures and unconfirmed empty responses.
  const steamSnapshot = chooseSteamSnapshot(freshSteam, oldData.steam, steamFetchSuccess);
  if (steamSnapshot.usedPrevious) {
    logger.warn({ fetchSucceeded: steamFetchSuccess, freshCount: freshSteam.length, keptCount: oldData.steam.length }, 'keeping previous Steam snapshot');
  }
  const steam = steamSnapshot.games;

  // Fetch Game Pass for PC catalog. Збій Microsoft-каталогу не має валити ран
  // і не має стирати попередній каталог — лишаємо старі дані, якщо нові пусті.
  let freshGamePass: GamePassGame[] = [];
  let gamepassFetchSuccess = false;
  try {
    freshGamePass = await fetchGamePassGames();
    gamepassFetchSuccess = true;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'gamepass fetch failed');
  }
  if (gamepassFetchSuccess && freshGamePass.length === 0 && (oldData.gamepass?.length ?? 0) > 0) {
    logger.warn('⚠️ gamepass fetch succeeded but returned an empty list. Keeping previous catalog.');
  }
  const gamepass: GamePassGame[] =
    gamepassFetchSuccess && freshGamePass.length > 0 ? freshGamePass : oldData.gamepass ?? [];

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

    // TG: той самий порог, що й на сайті (від CONFIG.minDiscountPercent) —
    // правила сайту та каналу однакові; анти-спам нижче ріже обсяг.
    // Free games are excluded here on purpose: they already go through the free
    // branch above and must never be announced as a "-100%" discount too.
    if (!game.isFree && game.isSpecial && game.discountPercent >= CONFIG.minDiscountPercent) {
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

  // Game Pass: новинки каталогу. Перший ран після деплою (жодного ключа
  // gamepass_ в історії) лише запам'ятовує поточний список — без заливки
  // каналу десятками постів; далі постимо тільки реально нові ігри.
  const hasGamePassHistory = Object.keys(notifiedHistory).some((key) => key.startsWith('gamepass_') && !key.startsWith('gamepass_popular_'));
  const newGamePassGames = planGamePassNewEntries(gamepass, notifiedHistory);
  if (!hasGamePassHistory) {
    for (const game of gamepass) {
      if (game.isNew && !notifiedHistory[`gamepass_${game.id}`]) {
        markNotified(`gamepass_${game.id}`, {
          title: game.title, price: 0, percent: 0, timestamp: now.toISOString(), type: 'gamepass',
        });
      }
    }
  }
  if (newGamePassGames.length > CONFIG.tgMaxDealsPerRun) {
    logger.info(
      { total: newGamePassGames.length, capped: CONFIG.tgMaxDealsPerRun },
      'capping gamepass telegram posts (rest stays for next run)',
    );
    newGamePassGames.length = CONFIG.tgMaxDealsPerRun;
  }

  // Game Pass: топ популярних — постимо гру, коли вона вперше потрапляє в
  // список «Most popular» (повторних постів про той самий топ немає).
  // Гра, яку цього ж рану вже запостили як новинку, не дублюється.
  const hasGamePassPopularHistory = Object.keys(notifiedHistory).some((key) => key.startsWith('gamepass_popular_'));
  const newPopularGamePassGames: GamePassGame[] = [];
  const justPostedGamePassIds = new Set(newGamePassGames.map((g) => g.id));
  for (const game of gamepass) {
    if (!game.isPopular) continue;
    const historyKey = `gamepass_popular_${game.id}`;
    if (notifiedHistory[historyKey]) continue;
    if (!hasGamePassPopularHistory || justPostedGamePassIds.has(game.id)) {
      markNotified(historyKey, {
        title: game.title, price: 0, percent: 0, timestamp: now.toISOString(), type: 'gamepass',
      });
      continue;
    }
    newPopularGamePassGames.push(game);
  }
  if (newPopularGamePassGames.length > CONFIG.tgMaxDealsPerRun) {
    logger.info(
      { total: newPopularGamePassGames.length, capped: CONFIG.tgMaxDealsPerRun },
      'capping gamepass popular telegram posts (rest stays for next run)',
    );
    newPopularGamePassGames.length = CONFIG.tgMaxDealsPerRun;
  }

  logger.info(
    `Detected: ${newSteamFreeGames.length} free Steam, ${newSteamDeals.length} hot Steam (total ${freshSteam.length}), ` +
    `${newGamePassGames.length} new Game Pass, ${newPopularGamePassGames.length} popular Game Pass (catalog ${gamepass.length}).`,
  );

  async function saveHistory() {
    await writeJsonAtomically(HISTORY_PATH, notifiedHistory);
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

  // Persist delivery intent before any Telegram request. The workflow pushes
  // this outbox, then claims/sends one message per durable checkpoint.
  const outbox = readNotificationOutbox();
  const queuedKeys = pendingReceiptKeys(outbox);
  async function sendBatched<T>(
    header: string,
    items: T[],
    footer: string,
    buildItem: (item: T) => string,
    receiptFor: (item: T) => OutboxReceipt,
  ) {
    const eligible = items.filter(item => {
      const key = receiptFor(item).key;
      return !notifiedHistory[key] && !queuedKeys.has(key);
    });
    if (eligible.length === 0) return;
    const batches = buildTelegramBatches(eligible, header, footer, buildItem, TG_MESSAGE_LIMIT - 100, CONFIG.tgMaxDealsPerRun);
    for (const batch of batches) {
      const receipts = batch.items.map(receiptFor);
      const queued = enqueueMessage(outbox, batch.text, receipts, now);
      if (!queued) continue;
      for (const receipt of queued.receipts) queuedKeys.add(receipt.key);
      logger.info({ messageId: queued.id, count: queued.receipts.length }, 'queued durable Telegram message');
    }
  }

  if (newSteamDeals.length > 0) {
    await sendBatched(
      `🔥 <b>ГАРЯЧІ ЗНИЖКИ В STEAM (від 25%)!</b>\n\n`,
      newSteamDeals,
      `🚀 Більше знижок дивіться на нашому сайті!`,
      (deal) => formatDealLine(deal.title, deal.discountPercent, deal.originalPrice, deal.discountPrice, deal.currency, deal.url, 'Детальніше в Steam'),
      (deal) => ({ key: `steam_discount_${deal.id}`, entry: {
        title: deal.title, price: deal.discountPrice, percent: deal.discountPercent, timestamp: now.toISOString(), type: 'discount'
      } }),
    );
  }

  if (newSteamFreeGames.length > 0) {
    await sendBatched(
      `🎁 <b>БЕЗКОШТОВНІ ПРОПОЗИЦІЇ В STEAM!</b>\n\n`,
      newSteamFreeGames,
      `🚀 Інші пропозиції дивіться на нашому сайті!`,
      (game) => `🎮 ${gameTitle(game.title)}\n💰 <b>БЕЗКОШТОВНО</b>\n🔗 ${storeLink('Забрати в Steam', game.url)}`,
      (game) => ({ key: `steam_free_${game.id}`, entry: {
        title: game.title, price: 0, percent: 100, timestamp: now.toISOString(), type: 'free'
      } }),
    );
  }

  if (newGamePassGames.length > 0) {
    await sendBatched(
      `🎮 <b>НОВІ ІГРИ В PC GAME PASS!</b>\n\n`,
      newGamePassGames,
      `🚀 Більше ігор PC Game Pass дивіться на нашому сайті!`,
      (game) => {
        let text = `🎮 ${gameTitle(game.title)}\n`;
        const desc = game.description?.trim();
        if (desc) {
          text += `📝 ${escapeHtml(desc.slice(0, 120))}${desc.length > 120 ? '…' : ''}\n`;
        }
        text += `✅ Доступно в PC Game Pass\n`;
        text += `🔗 ${storeLink('Microsoft Store', game.url)}`;
        return text;
      },
      (game) => ({ key: `gamepass_${game.id}`, entry: {
        title: game.title, price: 0, percent: 0, timestamp: now.toISOString(), type: 'gamepass'
      } }),
    );
  }

  if (newPopularGamePassGames.length > 0) {
    await sendBatched(
      `🔥 <b>ПОПУЛЯРНЕ У PC GAME PASS!</b>\n\n`,
      newPopularGamePassGames,
      `🚀 Більше ігор PC Game Pass дивіться на нашому сайті!`,
      (game) => {
        let text = `🎮 ${gameTitle(game.title)}\n`;
        const desc = game.description?.trim();
        if (desc) {
          text += `📝 ${escapeHtml(desc.slice(0, 120))}${desc.length > 120 ? '…' : ''}\n`;
        }
        text += `🔥 Зараз у топі популярних PC Game Pass\n`;
        text += `🔗 ${storeLink('Microsoft Store', game.url)}`;
        return text;
      },
      (game) => ({ key: `gamepass_popular_${game.id}`, entry: {
        title: game.title, price: 0, percent: 0, timestamp: now.toISOString(), type: 'gamepass'
      } }),
    );
  }

  // Save updated data (Steam + Game Pass for PC; поле epic видалено).
  // notifiedHistory вбудовуємо і в deals.json: сайт читає історію саме звідти
  // (окремий notified-history.json — merge-friendly джерело для scheduler-а).
  const newData: DealsData = {
    lastUpdated: new Date().toISOString(),
    steam,
    gamepass,
    notifiedHistory
  };

  await writeJsonAtomically(DEALS_PATH, newData);
  logger.info(`✅ Saved new data to ${DEALS_PATH}`);

  pruneDelivered(outbox, now);
  await writeJsonAtomically(OUTBOX_PATH, outbox);

  // Persist the current delivered history snapshot alongside the catalog.
  await saveHistory();
  logger.info(`✅ Saved notified history to ${HISTORY_PATH}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let shuttingDown = false;
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.warn({ sig }, 'received shutdown signal, exiting');
      process.exit(143);
    });
  }

  const command = process.argv[2] ?? '--prepare';
  const task = command === '--prepare'
    ? runPrepare()
    : runOutboxCommand(process.argv.slice(2));
  task.catch(err => {
    logger.error({ err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err) }, 'critical error running fetcher');
    process.exit(1);
  });
}
