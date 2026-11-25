import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { fileURLToPath } from 'node:url';
import { RateLimiter } from './rate-limiter';
import {
  choosePlayStationSnapshot,
  chooseSteamSnapshot,
  filterQualitySteamGames,
  isValidSteamSearchPage,
  partitionMegaSteamDeals,
  planGamePassDealNotifications,
  planGamePassNewEntries,
  planPlayStationNotifications,
  resolveCatalogTimestamps,
  selectSteamNotifications,
  updatePriceHistory,
} from './collector-core';
import type { SteamMetadata } from './collector-core';
import { fetchPlayStationGames } from './playstation';
import { writeJsonAtomically } from './persistence';
import {
  buildTelegramBatches,
  isQuietHoursKyiv,
  normalizeTelegramPhotoUrl,
} from './telegram';
import type { TelegramReplyMarkup } from './telegram';
import {
  claimNextMessage, classifyDeliveryFailure, emptyOutbox, enqueueMessage, normalizeOutbox, pendingReceiptKeys,
  pruneDelivered, recordDeliveryOutcome,
} from './outbox';
import type { NotificationOutbox, OutboxReceipt } from './outbox';
import type { SteamGame, GamePassGame, PlayStationGame, DealsData, NotifiedItem } from './types';
import { formatPrice, formatReviewCount, escapeHtml } from './format';

const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'fetch-deals', runId },
});

const CONFIG = {
  dealsDir: process.env.DEALS_DIR ?? path.join(process.cwd(), 'public', 'data'),
  siteUrl: 'https://ajjs1ajjs.github.io/dist/sales/',
  freeGameCooldownMs: 14 * 24 * 60 * 60 * 1000,
  discountCooldownMs: 30 * 24 * 60 * 60 * 1000,
  historyRetentionMs: 30 * 24 * 60 * 60 * 1000,
  tgMessageLimit: 4000,
  minDiscountPercent: 30,
  topSellerMinDiscountPercent: 25,
  popularTopLimit: 40,
  tgMaxDealsPerRun: 7,
  tgMaxMegaCardsPerRun: 3,
  tgMaxDlcPerRun: 5,
  tgTimeoutMs: 10000,
  fetchTimeoutMs: 30000,
  fetchRetries: 3,
  fetchRetryDelayMs: 2000,
  searchPages: 2,
  searchCount: 100,
  dlcSearchCount: 60,
  steamQuality: {
    minReviewPercent: 70,
    minReviewCount: 500,
    newReleaseDays: 45,
    newReleaseMinReviews: 100,
    popularMinReviewPercent: 65,
    popularMinReviewCount: 100,
    dlcMinDiscountPercent: 25,
    dlcMinReviewCount: 300,
    dlcMinReviewPercent: 70,
    dlcMinOriginalPriceUah: 120,
  },
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
    minDiscountPercent: 25,
    tgMaxDealsPerRun: 5,
    // Ключі gamepass_ живуть довше за 30 днів: інакше гра, що тижнями
    // висить у «Recently added», після очистки сповістилася б повторно.
    historyRetentionMs: 120 * 24 * 60 * 60 * 1000,
  },
  playstation: {
    minDiscountPercent: 25,
    historyRetentionMs: 120 * 24 * 60 * 60 * 1000,
    tgMaxDealsPerRun: 7,
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

// Один лімітер на весь Steam (categories + search + metadata): безкоштовно, без ключа.
const steamLimiter = new RateLimiter(60);

// Microsoft-каталог: ~5 запитів на ран (2 списки + батчі деталей).
const gamepassLimiter = new RateLimiter(30);

// PlayStation Store GraphQL + PS Blog RSS: ~4 запити на ран.
const psLimiter = new RateLimiter(20);

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

interface StoreBrowseAssets {
  asset_url_format?: string;
  main_capsule?: string;
  header?: string;
}

interface StoreBrowseItem {
  appid?: number;
  type?: number;
  related_items?: {
    parent_appid?: number;
  };
  release?: {
    steam_release_date?: number;
  };
  reviews?: {
    summary_filtered?: {
      review_count?: number;
      percent_positive?: number;
      review_score_label?: string;
    };
  };
  assets?: StoreBrowseAssets;
}

interface StoreBrowseItemsResponse {
  response?: {
    store_items?: StoreBrowseItem[];
  };
}

function isLowResSteamCapsule(imageUrl: string): boolean {
  return /\/capsule_(?:sm_120|184x69|231x87)(?:[_a-z]*)\./i.test(imageUrl);
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
interface GamePassAvailability {
  Actions?: string[];
  OrderManagementData?: {
    Price?: {
      MSRP?: number;
      ListPrice?: number;
      CurrencyCode?: string;
    };
  };
}
interface GamePassSkuAvailability {
  Availabilities?: GamePassAvailability[];
}
interface GamePassProduct {
  ProductId?: string;
  LocalizedProperties?: GamePassLocalizedProperty[];
  DisplaySkuAvailabilities?: GamePassSkuAvailability[];
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
  extra?: { isDlc?: boolean; popularRank?: number },
) {
  if (!title) return;
  const existing = gamesMap.get(id);
  if (existing) {
    existing.isSpecial = existing.isSpecial || isSpecial;
    existing.isFree = existing.isFree || isFree;
    existing.isPopular = existing.isPopular || isPopular;
    if (extra?.isDlc) existing.isDlc = true;
    if (extra?.popularRank !== undefined) {
      existing.popularRank =
        existing.popularRank === undefined ? extra.popularRank : Math.min(existing.popularRank, extra.popularRank);
    }
    if (discountPercent > existing.discountPercent) {
      existing.discountPercent = discountPercent;
      existing.originalPrice = originalPrice;
      existing.discountPrice = discountPrice;
      if (imageUrl && (!existing.imageUrl || isLowResSteamCapsule(existing.imageUrl) || !isLowResSteamCapsule(imageUrl))) {
        existing.imageUrl = imageUrl;
      }
    } else if (imageUrl && (!existing.imageUrl || (isLowResSteamCapsule(existing.imageUrl) && !isLowResSteamCapsule(imageUrl)))) {
      existing.imageUrl = imageUrl;
    }
    return;
  }
  const resolvedImageUrl =
    imageUrl ||
    (/^\d+$/.test(id)
      ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${encodeURIComponent(id)}/header.jpg`
      : '');
  gamesMap.set(id, {
    id,
    title,
    imageUrl: resolvedImageUrl,
    originalPrice,
    discountPrice,
    discountPercent,
    currency: currency || 'UAH',
    url: `https://store.steampowered.com/app/${encodeURIComponent(id)}`,
    isSpecial,
    isFree,
    isPopular,
    ...(extra?.isDlc ? { isDlc: true } : {}),
    ...(extra?.popularRank !== undefined ? { popularRank: extra.popularRank } : {}),
  });
}

export function processCategoryItems(
  gamesMap: Map<string, SteamGame>,
  items: SteamItem[],
  opts: { specialBucket: boolean; popularBucket: boolean },
) {
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
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
    const minPct = opts.popularBucket ? CONFIG.topSellerMinDiscountPercent : CONFIG.minDiscountPercent;
    const isDiscounted = !isFree && pct >= minPct;
    const isSpecial = isDiscounted;
    const isPopular = opts.popularBucket;

    if (opts.specialBucket && !opts.popularBucket && !isSpecial && !isFree) continue;
    if (!isSpecial && !isFree && !isPopular) continue;

    upsertGame(
      gamesMap,
      id,
      item.name,
      imageUrl,
      originalPrice,
      discountPrice,
      pct,
      item.currency || 'UAH',
      isSpecial,
      isFree,
      isPopular,
      isPopular ? { popularRank: idx + 1 } : undefined,
    );
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

function parseSteamPriceText(raw: string): number | null {
  const cleaned = raw.replace(/[\s\u00a0]/g, '').replace(',', '.').replace(/[^0-9.]/g, '');
  if (!cleaned || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Парсинг однієї сторінки search API (topsellers + specials, ігри або DLC). */
export function parseSearchHtml(
  html: string,
  gamesMap: Map<string, SteamGame>,
  opts?: { isDlc?: boolean; popularLimit?: number; startOffset?: number },
): number {
  const anchorRe = /<a\b[^>]*data-ds-appid="(\d+)"[^>]*data-ds-itemkey="([^"]*)"[^>]*>([\s\S]*?)<\/a\s*>/g;
  let added = 0;
  let rowIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const appId = m[1];
    const itemKey = m[2] || '';
    // Тільки застосунки; Bundle/Package/Sub пропускаємо (ціни там за набір).
    if (!itemKey.startsWith('App_')) continue;
    const currentRank = (opts?.startOffset ?? 0) + rowIndex + 1;
    rowIndex++;
    const body = m[3];

    const titleM = body.match(/<span class="title"[^>]*>(.*?)<\/span>/s);
    const imgM = body.match(/<img\b[^>]*\bsrc="([^"]+)"/);
    const pctM =
      body.match(/<div class="discount_pct"[^>]*>\s*-(\d+)%\s*<\/div>/) ??
      body.match(/\bdata-discount="(\d+)"/);
    const origM = body.match(/<div class="discount_original_price"[^>]*>([^<]+)<\/div>/);
    const finalTextM = body.match(/<div class="discount_final_price"[^>]*>([^<]+)<\/div>/);
    const finalM = body.match(/data-price-final="(\d+)"/);
    if (!titleM || !pctM || !finalM) continue;

    const discountPercent = finiteOr(Number(pctM[1]), 0);
    const finalCents = finiteOr(Number(finalM[1]), NaN);
    if (!Number.isFinite(finalCents)) continue;
    const parsedOriginal = origM ? parseSteamPriceText(decodeEntities(origM[1])) : null;
    const parsedFinal = finalTextM ? parseSteamPriceText(decodeEntities(finalTextM[1])) : null;
    let discountPrice = finalCents / 100;
    if (finalCents === 0 && discountPercent < 100) {
      if (parsedFinal !== null && parsedFinal > 0) {
        discountPrice = parsedFinal;
      } else if (parsedOriginal !== null && parsedOriginal > 0 && discountPercent > 0) {
        discountPrice = Math.round(parsedOriginal * (1 - discountPercent / 100) * 100) / 100;
      }
    }
    const originalPrice =
      parsedOriginal !== null && parsedOriginal >= discountPrice
        ? parsedOriginal
        : discountPercent > 0 && discountPercent < 100
          ? Math.round((discountPrice / (1 - discountPercent / 100)) * 100) / 100
          : discountPrice;
    const isFree =
      discountPercent >= 100 ||
      (originalPrice > 0 && discountPrice === 0 && !(parsedFinal !== null && parsedFinal > 0));
    const isDlc = Boolean(opts?.isDlc);
    const isPopular = !isDlc && (opts?.popularLimit === undefined || currentRank <= opts.popularLimit);
    const minPct = isDlc
      ? CONFIG.steamQuality.dlcMinDiscountPercent
      : isPopular
        ? CONFIG.topSellerMinDiscountPercent
        : CONFIG.minDiscountPercent;
    const isSpecial = !isFree && discountPercent >= minPct;

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

    upsertGame(
      gamesMap,
      appId,
      title,
      imageUrl,
      originalPrice,
      discountPrice,
      isFree ? 100 : discountPercent,
      'UAH',
      isSpecial,
      isFree,
      isPopular,
      {
        ...(isDlc ? { isDlc: true } : {}),
        ...(isPopular && opts?.popularLimit !== undefined ? { popularRank: currentRank } : {}),
      },
    );
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
      `&filter=topsellers&specials=1&category1=998&cc=UA&l=ukrainian`;
    const res = await fetchWithRetry(
      url,
      { headers: { 'User-Agent': STEAM_UA, Accept: 'application/json' } },
    );
    const data = (await res.json()) as SteamSearchResponse;
    if (!isValidSteamSearchPage(data)) {
      throw new Error(`Steam search page ${page} returned an incomplete response.`);
    }
    const added = parseSearchHtml(data.results_html, gamesMap, {
      popularLimit: CONFIG.popularTopLimit,
      startOffset: start,
    });
    if (
      page === 0 &&
      added === 0 &&
      /data-ds-itemkey="App_\d+"/.test(data.results_html) &&
      /discount_pct|data-discount=/.test(data.results_html)
    ) {
      throw new Error('Steam search page 0 contained discounted app rows but 0 were parsed.');
    }
    logger.info({ page, start, total: data.total_count ?? -1, added }, 'steam search page fetched');
    if (data.results_html.length < 1000) break;
  }

  // Fetch top-selling DLCs with discounts (category1=21) separately.
  try {
    await steamLimiter.take();
    const dlcUrl =
      `https://store.steampowered.com/search/results/?query&start=0` +
      `&count=${CONFIG.dlcSearchCount}&dynamic_data=&sort_by=_ASC&snr=1_7_7_230_7&infinite=1` +
      `&filter=topsellers&specials=1&category1=21&cc=UA&l=ukrainian`;
    const res = await fetchWithRetry(
      dlcUrl,
      { headers: { 'User-Agent': STEAM_UA, Accept: 'application/json' } },
    );
    const data = (await res.json()) as SteamSearchResponse;
    if (isValidSteamSearchPage(data)) {
      const dlcAdded = parseSearchHtml(data.results_html, gamesMap, { isDlc: true });
      logger.info({ total: data.total_count ?? -1, dlcAdded }, 'steam DLC search page fetched');
    }
  } catch (err) {
    logger.warn({ err: sanitizeLog(err) }, 'steam DLC search failed (continuing with base games)');
  }
}

function resolveStoreBrowseAssetUrl(assets?: StoreBrowseAssets): string | undefined {
  const filename = assets?.main_capsule || assets?.header;
  if (!filename) return undefined;
  const format = assets?.asset_url_format;
  const relative = format && format.includes('${FILENAME}')
    ? format.replace('${FILENAME}', filename)
    : filename;
  const rawUrl = /^https?:\/\//i.test(relative)
    ? relative
    : `https://shared.akamai.steamstatic.com/store_item_assets/${relative.replace(/^\/+/, '')}`;
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return undefined;
  }
}

async function enrichSteamMetadata(gamesMap: Map<string, SteamGame>): Promise<Map<string, SteamMetadata>> {
  const metaMap = new Map<string, SteamMetadata>();
  const appIds: number[] = [];
  for (const id of gamesMap.keys()) {
    if (!/^\d+$/.test(id)) continue;
    const appid = Number(id);
    if (Number.isSafeInteger(appid) && appid > 0) appIds.push(appid);
  }
  if (appIds.length === 0) return metaMap;

  const batchSize = 100;
  let upgradedImages = 0;
  for (let i = 0; i < appIds.length; i += batchSize) {
    const batch = appIds.slice(i, i + batchSize);
    try {
      await steamLimiter.take();
      const inputJson = JSON.stringify({
        ids: batch.map(appid => ({ appid })),
        context: { language: 'ukrainian', country_code: 'UA' },
        data_request: {
          include_assets: true,
          include_basic_info: true,
          include_reviews: true,
          include_release: true,
        },
      });
      const url = `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(inputJson)}`;
      const res = await fetchWithRetry(url, { headers: { 'User-Agent': STEAM_UA, Accept: 'application/json' } });
      const data = (await res.json()) as StoreBrowseItemsResponse;
      for (const item of data.response?.store_items ?? []) {
        if (!item.appid) continue;
        const id = String(item.appid);
        const game = gamesMap.get(id);
        if (!game) continue;

        const summary = item.reviews?.summary_filtered;
        metaMap.set(id, {
          type: item.type,
          parentAppId: item.related_items?.parent_appid ? String(item.related_items.parent_appid) : undefined,
          reviewCount: summary?.review_count,
          reviewPercent: summary?.percent_positive,
          reviewLabel: summary?.review_score_label,
          releaseTimeSec: item.release?.steam_release_date,
        });

        if (!game.imageUrl || isLowResSteamCapsule(game.imageUrl)) {
          const resolved = resolveStoreBrowseAssetUrl(item.assets);
          if (resolved && (!game.imageUrl || !isLowResSteamCapsule(resolved))) {
            game.imageUrl = resolved;
            upgradedImages++;
          }
        }
      }
    } catch (err) {
      logger.warn({ count: batch.length, err: sanitizeLog(err) }, 'steam metadata enrichment batch failed');
    }
  }
  logger.info({ candidates: appIds.length, resolved: metaMap.size, upgradedImages }, 'steam metadata enriched');
  return metaMap;
}

async function fetchSteamGames(): Promise<SteamGame[]> {
  logger.info('Fetching Steam: categories + topsellers + DLC + reviews...');
  const gamesMap = new Map<string, SteamGame>();

  await fetchSteamCategories(gamesMap);
  await fetchSteamSearchDeals(gamesMap);
  const metaMap = await enrichSteamMetadata(gamesMap);
  const rawGames = Array.from(gamesMap.values());
  if (metaMap.size === 0) {
    logger.warn('Steam metadata unavailable; skipping quality filter for this run');
    return rawGames;
  }
  const filtered = filterQualitySteamGames(rawGames, metaMap, new Date(), {
    minDiscountPercent: CONFIG.minDiscountPercent,
    topSellerMinDiscountPercent: CONFIG.topSellerMinDiscountPercent,
    ...CONFIG.steamQuality,
  });
  logger.info({ rawCount: rawGames.length, filteredCount: filtered.length }, 'steam quality filter applied');
  return filtered;
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

interface GamePassPricing {
  originalPrice?: number;
  discountPrice?: number;
  discountPercent?: number;
  currency?: string;
  isDeal?: boolean;
}

function pickGamePassPricing(product: GamePassProduct): GamePassPricing {
  let best: GamePassPricing | null = null;
  for (const sku of product.DisplaySkuAvailabilities ?? []) {
    for (const avail of sku.Availabilities ?? []) {
      const actions = avail.Actions ?? [];
      if (!actions.includes('Purchase')) continue;
      const price = avail.OrderManagementData?.Price;
      const msrp = Number(price?.MSRP);
      const list = Number(price?.ListPrice);
      if (!Number.isFinite(msrp) || !Number.isFinite(list) || msrp <= 0 || list <= 0 || list >= msrp) continue;
      const discountPercent = Math.round((1 - list / msrp) * 100);
      if (discountPercent <= 0) continue;
      if (!best || discountPercent > (best.discountPercent ?? 0)) {
        best = {
          originalPrice: Math.round(msrp * 100) / 100,
          discountPrice: Math.round(list * 100) / 100,
          discountPercent,
          currency: typeof price?.CurrencyCode === 'string' && /^[A-Z]{3}$/.test(price.CurrencyCode) ? price.CurrencyCode : 'UAH',
          isDeal: discountPercent >= CONFIG.gamepass.minDiscountPercent,
        };
      }
    }
  }
  return best ?? {};
}

/** Деталі продуктів (назва/опис/зображення/ціна) батчами через displaycatalog. */
async function fetchGamePassDetails(
  ids: string[],
): Promise<Map<string, { title: string; description: string; imageUrl: string; pricing: GamePassPricing }>> {
  const details = new Map<string, { title: string; description: string; imageUrl: string; pricing: GamePassPricing }>();
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
        details.set(id, {
          title,
          description: pickGamePassDescription(product),
          imageUrl: pickGamePassImage(product),
          pricing: pickGamePassPricing(product),
        });
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
      ...detail.pricing,
    });
  }
  logger.info(
    { total: games.length, recentlyAdded: newIds.length, mostPopular: popularIds.length },
    'gamepass catalog fetched',
  );
  return games;
}

async function postTelegramEndpoint(
  token: string,
  endpoint: 'sendMessage' | 'sendPhoto',
  payload: Record<string, unknown>,
): Promise<{ response: Response; logSafeUrl: string }> {
  const url = `https://api.telegram.org/bot${token}/${endpoint}`;
  const logSafeUrl = `https://api.telegram.org/bot[REDACTED]/${endpoint}`;

  // Each outbox claim gets one HTTP request per endpoint attempt. If the response
  // is lost, retrying inside this helper could duplicate a Telegram post before
  // Git records an outcome; the caller marks that case uncertain for operator review.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.tgTimeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return { response, logSafeUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const sanitized = message.split(token).join('[REDACTED]');
    logger.warn({ url: logSafeUrl, attempt: 1, attempts: 1, err: sanitized }, 'telegram api network error');
    throw new Error(`Telegram send failed: ${sanitized}`, { cause: err });
  } finally {
    clearTimeout(timeout);
  }
}

async function sendTelegramMessage(
  text: string,
  photoUrl?: string,
  opts?: { replyMarkup?: TelegramReplyMarkup; disableNotification?: boolean },
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    logger.info('⚠️ Telegram credentials not found (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID). Skipping notification.');
    return false;
  }

  const normalizedPhotoUrl = normalizeTelegramPhotoUrl(photoUrl);
  const commonOpts = {
    ...(opts?.replyMarkup ? { reply_markup: opts.replyMarkup } : {}),
    ...(opts?.disableNotification ? { disable_notification: true } : {}),
  };
  const textPayload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...commonOpts,
  };

  let result = normalizedPhotoUrl
    ? await postTelegramEndpoint(token, 'sendPhoto', {
        chat_id: chatId,
        photo: normalizedPhotoUrl,
        caption: text,
        parse_mode: 'HTML',
        ...commonOpts,
      })
    : await postTelegramEndpoint(token, 'sendMessage', textPayload);

  if (normalizedPhotoUrl && result.response.status === 400) {
    const errBody = await result.response.text().catch(() => '');
    logger.warn(
      { url: result.logSafeUrl, status: result.response.status, errBody: sanitizeLog(errBody).slice(0, 300) },
      'telegram sendPhoto returned 400, falling back to sendMessage',
    );
    result = await postTelegramEndpoint(token, 'sendMessage', textPayload);
  }

  const { response, logSafeUrl } = result;
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
      delivered = await sendTelegramMessage(message.text, message.photoUrl, {
        replyMarkup: message.replyMarkup,
        disableNotification: message.disableNotification,
      });
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
  logger.info('Starting deals fetcher script (Steam + Game Pass PC + PlayStation 5)...');

  // Load previous deals for comparison.
  const coerceOldData = (parsed: unknown): DealsData => {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid previous catalog');
    const p = parsed as Record<string, unknown>;
    if (p.priceHistory !== undefined && (!p.priceHistory || typeof p.priceHistory !== 'object' || Array.isArray(p.priceHistory))) {
      throw new Error('Invalid price history; refusing to overwrite the previous catalog');
    }
    const rawUpdates = p.sourceUpdates && typeof p.sourceUpdates === 'object' && !Array.isArray(p.sourceUpdates)
      ? (p.sourceUpdates as Record<string, unknown>)
      : undefined;
    const sourceUpdates = rawUpdates
      ? {
          steam: typeof rawUpdates.steam === 'string' ? rawUpdates.steam : undefined,
          gamepass: typeof rawUpdates.gamepass === 'string' ? rawUpdates.gamepass : undefined,
          playstation: typeof rawUpdates.playstation === 'string' ? rawUpdates.playstation : undefined,
        }
      : undefined;
    return {
      lastUpdated: typeof p.lastUpdated === 'string' ? p.lastUpdated : '',
      sourceUpdates,
      priceHistory: p.priceHistory as DealsData['priceHistory'],
      steam: Array.isArray(p.steam) ? (p.steam as DealsData['steam']) : [],
      gamepass: Array.isArray(p.gamepass) ? (p.gamepass as GamePassGame[]) : [],
      playstation: Array.isArray(p.playstation) ? (p.playstation as PlayStationGame[]) : [],
      notifiedHistory: {},
    };
  };

  let oldData: DealsData = { lastUpdated: '', steam: [], gamepass: [], playstation: [], notifiedHistory: {} };
  if (fs.existsSync(DEALS_PATH)) {
    try {
      oldData = coerceOldData(JSON.parse(fs.readFileSync(DEALS_PATH, 'utf-8')));
      logger.info('Loaded previous deals from local path.');
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'failed to parse old local deals.json');
      throw new Error('Previous local catalog is unreadable; refusing to overwrite it', { cause: err });
    }
  } else {
    try {
      const githubPagesUrl = `https://ajjs1ajjs.github.io/dist/sales/data/deals.json`;
      logger.info(`Trying to fetch previous deals from GitHub Pages: ${githubPagesUrl}`);
      const res = await fetch(githubPagesUrl, { signal: AbortSignal.timeout(CONFIG.fetchTimeoutMs) });
      if (res.ok) {
        oldData = coerceOldData(await res.json());
        logger.info('✅ Loaded previous deals from GitHub Pages.');
      }
    } catch {
      logger.info('⚠️ Could not fetch from GitHub Pages, starting fresh.');
    }
  }

  // Load notified history from the separate file (append-only, merge-friendly).
  const notifiedHistory = await loadNotifiedHistory(
    {
      readLocal: () =>
        fs.existsSync(HISTORY_PATH) ? fs.readFileSync(HISTORY_PATH, 'utf-8') : undefined,
      readRemote: async () => {
        const res = await fetch(HISTORY_REMOTE_URL, { signal: AbortSignal.timeout(CONFIG.fetchTimeoutMs) });
        return res.ok ? await res.json() : undefined;
      },
    },
    logger,
  );

  // Clean notified history: remove expired and corrupted (NaN timestamp) entries
  const now = new Date();

  for (const [key, value] of Object.entries(notifiedHistory)) {
    const notifiedTime = new Date(value.timestamp).getTime();
    const isLongRetention =
      (key.startsWith('gamepass_') && !key.startsWith('gamepass_deal_')) ||
      key.startsWith('ps_essential_') ||
      key.startsWith('ps_extra_');
    const maxAgeMs = isLongRetention ? CONFIG.gamepass.historyRetentionMs : CONFIG.historyRetentionMs;
    if (Number.isNaN(notifiedTime) || notifiedTime < now.getTime() - maxAgeMs) {
      delete notifiedHistory[key];
    }
  }

  function markNotified(key: string, entry: NotifiedItem) {
    notifiedHistory[key] = entry;
  }

  // Fetch fresh Steam data
  let steamFetchSuccess = false;
  const freshSteam = await fetchSteamGames().then(r => { steamFetchSuccess = true; return r; }).catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'steam fetch failed');
    return [] as SteamGame[];
  });

  const steamSnapshot = chooseSteamSnapshot(freshSteam, oldData.steam, steamFetchSuccess);
  if (steamSnapshot.usedPrevious) {
    logger.warn({ fetchSucceeded: steamFetchSuccess, freshCount: freshSteam.length, keptCount: oldData.steam.length }, 'keeping previous Steam snapshot');
  }
  const steam = steamSnapshot.games;
  const steamUpdated = !steamSnapshot.usedPrevious && freshSteam.length > 0;

  // Fetch Game Pass for PC catalog
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
  const gamepassUsedPrevious = !gamepassFetchSuccess || (freshGamePass.length === 0 && (oldData.gamepass?.length ?? 0) > 0);
  const gamepass: GamePassGame[] =
    gamepassUsedPrevious ? (oldData.gamepass ?? []) : freshGamePass;
  const gamepassUpdated = !gamepassUsedPrevious && freshGamePass.length > 0;

  // Fetch PlayStation 5 (PS Store Deals + Top Sellers + PS Plus Essential & Extra)
  let freshPlayStation: PlayStationGame[] = [];
  let playstationFetchSuccess = false;
  try {
    freshPlayStation = await fetchPlayStationGames(
      (url, options) => fetchWithRetry(url, options, CONFIG.fetchRetries, CONFIG.fetchRetryDelayMs, CONFIG.fetchTimeoutMs),
      psLimiter,
      { minDiscountPercent: CONFIG.playstation.minDiscountPercent },
    );
    playstationFetchSuccess = true;
    logger.info({ count: freshPlayStation.length }, 'playstation catalog fetched');
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'playstation fetch failed');
  }
  const psSnapshot = choosePlayStationSnapshot(freshPlayStation, oldData.playstation ?? [], playstationFetchSuccess);
  if (psSnapshot.usedPrevious) {
    logger.warn(
      { fetchSucceeded: playstationFetchSuccess, freshCount: freshPlayStation.length, keptCount: oldData.playstation?.length ?? 0 },
      'keeping previous PlayStation snapshot',
    );
  }
  const playstation = psSnapshot.games;
  const playstationUpdated = !psSnapshot.usedPrevious && freshPlayStation.length > 0;

  // Update 90-day price history (Steam + PS5) before notifications so lowest-price badges are current.
  const priceHistory = updatePriceHistory(
    oldData.priceHistory,
    freshSteam,
    now,
    steamUpdated,
    freshPlayStation,
    playstationUpdated,
  );

  // Read outbox early so already-queued items do not consume the per-run cap.
  const outbox = readNotificationOutbox();
  const queuedKeys = pendingReceiptKeys(outbox);

  // Detect Steam changes (freebies + base-game deals + DLC deals)
  const { freeGames: newSteamFreeGames, deals: newSteamDeals, dlcDeals: newSteamDlcDeals } = selectSteamNotifications(
    freshSteam,
    notifiedHistory,
    queuedKeys,
    now,
    {
      minDiscountPercent: CONFIG.topSellerMinDiscountPercent,
      freeCooldownMs: FREE_GAME_COOLDOWN_MS,
      discountCooldownMs: DISCOUNT_COOLDOWN_MS,
      maxDealsPerRun: CONFIG.tgMaxDealsPerRun,
      maxDlcPerRun: CONFIG.tgMaxDlcPerRun,
    },
  );
  const { megaDeals: newSteamMegaDeals, digestDeals: newSteamDigestDeals } = partitionMegaSteamDeals(
    newSteamDeals,
    CONFIG.tgMaxMegaCardsPerRun,
  );

  // Game Pass: новинки, популярне та знижки
  const hasGamePassHistory = Object.keys(notifiedHistory).some(
    (key) => key.startsWith('gamepass_') && !key.startsWith('gamepass_popular_') && !key.startsWith('gamepass_deal_'),
  );
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
    newGamePassGames.length = CONFIG.tgMaxDealsPerRun;
  }

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
    newPopularGamePassGames.length = CONFIG.tgMaxDealsPerRun;
  }

  const newGamePassDeals = planGamePassDealNotifications(gamepass, notifiedHistory, queuedKeys, now, {
    minDiscountPercent: CONFIG.gamepass.minDiscountPercent,
    discountCooldownMs: DISCOUNT_COOLDOWN_MS,
    maxDealsPerRun: CONFIG.gamepass.tgMaxDealsPerRun,
  });

  // PlayStation 5: PS Plus Essential (baseline-guarded), PS Plus Extra (baseline-guarded), and PS5 Deals
  const hasPsEssentialHistory = Object.keys(notifiedHistory).some((key) => key.startsWith('ps_essential_'));
  const hasPsExtraHistory = Object.keys(notifiedHistory).some((key) => key.startsWith('ps_extra_'));
  if (!hasPsEssentialHistory) {
    for (const game of playstation) {
      if (game.psPlusTier === 'essential' && !notifiedHistory[game.id]) {
        markNotified(game.id, {
          title: game.title, price: 0, percent: 100, timestamp: now.toISOString(), type: 'ps_essential',
        });
      }
    }
  }
  if (!hasPsExtraHistory) {
    for (const game of playstation) {
      if (game.psPlusTier === 'extra' && !notifiedHistory[game.id]) {
        markNotified(game.id, {
          title: game.title, price: 0, percent: 0, timestamp: now.toISOString(), type: 'ps_extra',
        });
      }
    }
  }
  const {
    essential: newPsEssentialGames,
    extra: newPsExtraGames,
    deals: newPsDeals,
  } = planPlayStationNotifications(freshPlayStation, notifiedHistory, queuedKeys, now, {
    minDiscountPercent: CONFIG.playstation.minDiscountPercent,
    discountCooldownMs: DISCOUNT_COOLDOWN_MS,
    maxDealsPerRun: CONFIG.playstation.tgMaxDealsPerRun,
  });

  logger.info(
    `Detected: ${newSteamFreeGames.length} free Steam, ${newSteamMegaDeals.length} mega + ${newSteamDigestDeals.length} Steam deals, ` +
    `${newSteamDlcDeals.length} Steam DLC (total ${freshSteam.length}), ` +
    `${newGamePassGames.length} new + ${newPopularGamePassGames.length} popular + ${newGamePassDeals.length} deals Game Pass (${gamepass.length}), ` +
    `${newPsEssentialGames.length} PS+ Essential, ${newPsExtraGames.length} PS+ Extra, ${newPsDeals.length} PS5 deals (${playstation.length}).`,
  );

  async function saveHistory() {
    await writeJsonAtomically(HISTORY_PATH, notifiedHistory);
  }

  const quietHours = isQuietHoursKyiv(now);
  const gameTitle = (name: string) => `<b>${escapeHtml(name)}</b>`;
  const truncateText = (value: string | undefined, max: number): string => {
    const cleaned = value?.replace(/\s+/g, ' ').trim() ?? '';
    if (!cleaned) return '';
    return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned;
  };
  const siteButtonRow = (label = '🌐 Всі знижки на сайті'): TelegramReplyMarkup => ({
    inline_keyboard: [[{ text: label, url: CONFIG.siteUrl }]],
  });

  const isLowestObservedPrice = (id: string, currentPrice: number, currency: string): boolean => {
    const obs = (priceHistory[id] ?? []).filter((o) => o.currency === currency);
    if (obs.length < 2) return false;
    const minObserved = Math.min(...obs.map((o) => o.price));
    return currentPrice <= minObserved;
  };

  function formatSteamHeroDeal(deal: SteamGame): string {
    const lines = [
      `🎮 ${gameTitle(deal.title)}`,
      `🏷️ Знижка: <b>-${deal.discountPercent}%</b>`,
      `💰 Ціна: <s>${formatPrice(deal.originalPrice, deal.currency)}</s> ➡️ <b>${formatPrice(deal.discountPrice, deal.currency)}</b>`,
    ];
    if (deal.reviewPercent !== undefined && deal.reviewCount) {
      lines.push(`👍 Відгуки: <b>${deal.reviewPercent}%</b> (${formatReviewCount(deal.reviewCount)})`);
    }
    if (isLowestObservedPrice(deal.id, deal.discountPrice, deal.currency)) {
      lines.push(`📉 <b>Найнижча ціна за 90 днів</b>`);
    }
    return lines.join('\n');
  }

  function formatGamePassSubscriptionCard(game: GamePassGame, statusLine: string): string {
    const lines = [`🎮 ${gameTitle(game.title)}`, statusLine];
    if (game.isDeal && game.discountPercent && typeof game.discountPrice === 'number') {
      const currency = game.currency ?? 'UAH';
      const orig = game.originalPrice ?? game.discountPrice;
      lines.push(
        `🏷️ Знижка на покупку: <b>-${game.discountPercent}%</b> (<s>${formatPrice(orig, currency)}</s> ➡️ <b>${formatPrice(game.discountPrice, currency)}</b>)`,
      );
    }
    const shortDesc = truncateText(game.description, 140);
    if (shortDesc) lines.push(`<i>${escapeHtml(shortDesc)}</i>`);
    return lines.join('\n');
  }

  async function sendPhotoCards<T>(
    header: string,
    items: T[],
    footer: string,
    buildItem: (item: T) => string,
    receiptFor: (item: T) => OutboxReceipt,
    getPhotoUrl: (item: T) => string | undefined,
    getReplyMarkup: (item: T) => TelegramReplyMarkup,
  ) {
    const eligible = items.filter(item => !queuedKeys.has(receiptFor(item).key));
    if (eligible.length === 0) return;
    const batches = buildTelegramBatches(eligible, header, footer, buildItem, TG_MESSAGE_LIMIT - 100, CONFIG.tgMaxDealsPerRun, getPhotoUrl);
    for (const batch of batches) {
      const receipts = batch.items.map(receiptFor);
      const replyMarkup = batch.items.length === 1 ? getReplyMarkup(batch.items[0]) : siteButtonRow();
      const queued = enqueueMessage(outbox, batch.text, receipts, now, batch.photoUrl, {
        replyMarkup,
        disableNotification: quietHours,
      });
      if (!queued) continue;
      for (const receipt of queued.receipts) queuedKeys.add(receipt.key);
      logger.info({ messageId: queued.id, count: queued.receipts.length }, 'queued durable Telegram card');
    }
  }

  // 1. Steam Freebies (окремі картки з обкладинкою)
  if (newSteamFreeGames.length > 0) {
    await sendPhotoCards(
      `🎁 <b>БЕЗКОШТОВНО В STEAM!</b>\n\n`,
      newSteamFreeGames,
      `#steam #безкоштовно`,
      (game) => `🎮 ${gameTitle(game.title)}\n💰 <b>БЕЗКОШТОВНО</b>`,
      (game) => ({ key: `steam_free_${game.id}`, entry: {
        title: game.title, price: 0, percent: 100, timestamp: now.toISOString(), type: 'free'
      } }),
      (game) => game.imageUrl,
      (game) => ({
        inline_keyboard: [[
          { text: '🎁 Забрати в Steam', url: game.url },
          { text: '🌐 Сайт', url: CONFIG.siteUrl },
        ]],
      }),
    );
  }

  // 2. Steam Mega-Hits (окремі картки з обкладинкою та рейтингом)
  if (newSteamMegaDeals.length > 0) {
    await sendPhotoCards(
      `🔥 <b>ХІТ-ЗНИЖКА В STEAM!</b>\n\n`,
      newSteamMegaDeals,
      `#steam #знижки #хіт`,
      formatSteamHeroDeal,
      (deal) => ({ key: `steam_discount_${deal.id}`, entry: {
        title: deal.title, price: deal.discountPrice, percent: deal.discountPercent, timestamp: now.toISOString(), type: 'discount'
      } }),
      (deal) => deal.imageUrl,
      (deal) => ({
        inline_keyboard: [[
          { text: '🛒 Купити в Steam', url: deal.url },
          { text: '🌐 Всі знижки', url: CONFIG.siteUrl },
        ]],
      }),
    );
  }

  // 3. Steam Regular Hot Deals (окремі картки з обкладинкою)
  if (newSteamDigestDeals.length > 0) {
    await sendPhotoCards(
      `🔥 <b>ТОП ЗНИЖКА В STEAM!</b>\n\n`,
      newSteamDigestDeals,
      `#steam #знижки`,
      formatSteamHeroDeal,
      (deal) => ({ key: `steam_discount_${deal.id}`, entry: {
        title: deal.title, price: deal.discountPrice, percent: deal.discountPercent, timestamp: now.toISOString(), type: 'discount'
      } }),
      (deal) => deal.imageUrl,
      (deal) => ({
        inline_keyboard: [[
          { text: '🛒 Купити в Steam', url: deal.url },
          { text: '🌐 Всі знижки', url: CONFIG.siteUrl },
        ]],
      }),
    );
  }

  // 4. Steam Major DLC Deals (окремі картки з обкладинкою)
  if (newSteamDlcDeals.length > 0) {
    await sendPhotoCards(
      `🧩 <b>ЗНИЖКА НА DLC У STEAM!</b>\n\n`,
      newSteamDlcDeals,
      `#steam #dlc #знижки`,
      formatSteamHeroDeal,
      (deal) => ({ key: `steam_dlc_${deal.id}`, entry: {
        title: deal.title, price: deal.discountPrice, percent: deal.discountPercent, timestamp: now.toISOString(), type: 'dlc'
      } }),
      (deal) => deal.imageUrl,
      (deal) => ({
        inline_keyboard: [[
          { text: '🛒 Купити DLC в Steam', url: deal.url },
          { text: '🌐 Всі знижки', url: CONFIG.siteUrl },
        ]],
      }),
    );
  }

  // 5. PC Game Pass — Нові надходження (окремі картки з обкладинкою)
  if (newGamePassGames.length > 0) {
    await sendPhotoCards(
      `🎮 <b>НОВИНКА В PC GAME PASS!</b>\n\n`,
      newGamePassGames,
      `#gamepass #pc`,
      (game) => formatGamePassSubscriptionCard(game, '✅ Включено у підписку PC Game Pass'),
      (game) => ({ key: `gamepass_${game.id}`, entry: {
        title: game.title, price: 0, percent: 0, timestamp: now.toISOString(), type: 'gamepass'
      } }),
      (game) => game.imageUrl,
      (game) => ({
        inline_keyboard: [[
          { text: '🎮 Відкрити в Xbox Store', url: game.url },
          { text: '🌐 Сайт', url: CONFIG.siteUrl },
        ]],
      }),
    );
  }

  // 6. PC Game Pass — Популярні у підписці (окремі картки з обкладинкою)
  if (newPopularGamePassGames.length > 0) {
    await sendPhotoCards(
      `🔥 <b>ПОПУЛЯРНЕ У PC GAME PASS!</b>\n\n`,
      newPopularGamePassGames,
      `#gamepass #pc #топ`,
      (game) => formatGamePassSubscriptionCard(game, '🔥 Топ популярних у PC Game Pass'),
      (game) => ({ key: `gamepass_popular_${game.id}`, entry: {
        title: game.title, price: 0, percent: 0, timestamp: now.toISOString(), type: 'gamepass'
      } }),
      (game) => game.imageUrl,
      (game) => ({
        inline_keyboard: [[
          { text: '🎮 Відкрити в Xbox Store', url: game.url },
          { text: '🌐 Сайт', url: CONFIG.siteUrl },
        ]],
      }),
    );
  }

  // 7. PC Game Pass / Xbox — Знижки на популярні та нові ігри (окремі картки з обкладинкою)
  if (newGamePassDeals.length > 0) {
    await sendPhotoCards(
      `🏷️ <b>ЗНИЖКА НА ХІТ У GAME PASS / XBOX!</b>\n\n`,
      newGamePassDeals,
      `#gamepass #xbox #знижки`,
      (deal) => {
        const currency = deal.currency ?? 'UAH';
        const orig = deal.originalPrice ?? deal.discountPrice ?? 0;
        const disc = deal.discountPrice ?? 0;
        const lines = [
          `🎮 ${gameTitle(deal.title)}`,
          `🏷️ Знижка: <b>-${deal.discountPercent ?? 0}%</b>`,
          `💰 Ціна: <s>${formatPrice(orig, currency)}</s> ➡️ <b>${formatPrice(disc, currency)}</b>`,
          `✅ Також у підписці PC Game Pass`,
        ];
        const shortDesc = truncateText(deal.description, 120);
        if (shortDesc) lines.push(`<i>${escapeHtml(shortDesc)}</i>`);
        return lines.join('\n');
      },
      (deal) => ({ key: `gamepass_deal_${deal.id}`, entry: {
        title: deal.title, price: deal.discountPrice ?? 0, percent: deal.discountPercent ?? 0, timestamp: now.toISOString(), type: 'gamepass_deal'
      } }),
      (deal) => deal.imageUrl,
      (deal) => ({
        inline_keyboard: [[
          { text: '🛒 Купити в Xbox Store', url: deal.url },
          { text: '🌐 Сайт', url: CONFIG.siteUrl },
        ]],
      }),
    );
  }

  // 8. PS Plus Essential (Ігри місяця — окремі картки з обкладинкою)
  if (newPsEssentialGames.length > 0) {
    await sendPhotoCards(
      `🎁 <b>PS PLUS ESSENTIAL — ГРА МІСЯЦЯ!</b>\n\n`,
      newPsEssentialGames,
      `#ps5 #psplus #essential #безкоштовно`,
      (game) => {
        const lines = [`🎮 ${gameTitle(game.title)}`];
        if (game.psPlusMonth) lines.push(`📅 ${escapeHtml(game.psPlusMonth)}`);
        lines.push(`🎁 Безкоштовно з підпискою PS Plus`);
        const shortDesc = truncateText(game.description, 150);
        if (shortDesc) lines.push(`<i>${escapeHtml(shortDesc)}</i>`);
        return lines.join('\n');
      },
      (game) => ({ key: game.id, entry: {
        title: game.title, price: 0, percent: 100, timestamp: now.toISOString(), type: 'ps_essential'
      } }),
      (game) => game.imageUrl,
      (game) => ({
        inline_keyboard: [[
          { text: '🎮 Відкрити в PS Store', url: game.url },
          { text: '🌐 Сайт', url: CONFIG.siteUrl },
        ]],
      }),
    );
  }

  // 9. PS Plus Extra (Новинки каталогу — окремі картки з обкладинкою)
  if (newPsExtraGames.length > 0) {
    await sendPhotoCards(
      `⭐ <b>НОВИНКА КАТАЛОГУ PS PLUS EXTRA!</b>\n\n`,
      newPsExtraGames,
      `#ps5 #psplus #extra`,
      (game) => {
        const lines = [`🎮 ${gameTitle(game.title)}`];
        if (game.psPlusMonth) lines.push(`📅 ${escapeHtml(game.psPlusMonth)}`);
        lines.push(`⭐ Доступно у підписці PS Plus Extra`);
        const shortDesc = truncateText(game.description, 150);
        if (shortDesc) lines.push(`<i>${escapeHtml(shortDesc)}</i>`);
        return lines.join('\n');
      },
      (game) => ({ key: game.id, entry: {
        title: game.title, price: 0, percent: 0, timestamp: now.toISOString(), type: 'ps_extra'
      } }),
      (game) => game.imageUrl,
      (game) => ({
        inline_keyboard: [[
          { text: '🎮 Відкрити в PS Store', url: game.url },
          { text: '🌐 Сайт', url: CONFIG.siteUrl },
        ]],
      }),
    );
  }

  // 10. PS5 Hot Deals (окремі картки з обкладинкою)
  if (newPsDeals.length > 0) {
    await sendPhotoCards(
      `🎮 <b>ЗНИЖКА PLAYSTATION 5!</b>\n\n`,
      newPsDeals,
      `#ps5 #знижки`,
      (deal) => {
        const currency = deal.currency ?? 'UAH';
        const orig = deal.originalPrice ?? deal.discountPrice ?? 0;
        const disc = deal.discountPrice ?? 0;
        const lines = [
          `🎮 ${gameTitle(deal.title)}`,
          `🏷️ Знижка: <b>-${deal.discountPercent ?? 0}%</b>`,
          `💰 Ціна: <s>${formatPrice(orig, currency)}</s> ➡️ <b>${formatPrice(disc, currency)}</b>`,
        ];
        if (deal.isPsPlusExclusive) lines.push(`⭐ Додаткова знижка з PS+`);
        if (typeof deal.discountPrice === 'number' && isLowestObservedPrice(deal.id, deal.discountPrice, currency)) {
          lines.push(`📉 <b>Найнижча ціна за 90 днів</b>`);
        }
        return lines.join('\n');
      },
      (deal) => ({ key: `ps_deal_${deal.id}`, entry: {
        title: deal.title, price: deal.discountPrice ?? 0, percent: deal.discountPercent ?? 0, timestamp: now.toISOString(), type: 'ps_deal'
      } }),
      (deal) => deal.imageUrl,
      (deal) => ({
        inline_keyboard: [[
          { text: '🛒 Купити в PS Store', url: deal.url },
          { text: '🌐 Сайт', url: CONFIG.siteUrl },
        ]],
      }),
    );
  }

  // Save updated data (Steam + Game Pass for PC + PlayStation 5).
  const { lastUpdated, sourceUpdates } = resolveCatalogTimestamps({
    nowIso: now.toISOString(),
    oldData,
    steamUpdated,
    gamepassUpdated,
    playstationUpdated,
  });

  const newData: DealsData = {
    lastUpdated,
    sourceUpdates,
    priceHistory,
    steam,
    gamepass,
    playstation,
    notifiedHistory,
  };

  await writeJsonAtomically(DEALS_PATH, newData);
  logger.info(`✅ Saved new data to ${DEALS_PATH}`);

  pruneDelivered(outbox, now);
  await writeJsonAtomically(OUTBOX_PATH, outbox);

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
