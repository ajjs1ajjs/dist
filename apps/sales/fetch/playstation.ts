import type { PlayStationGame, PsPlusTier } from './types';
import type { RateLimiter } from './rate-limiter';

export const PS_GRAPHQL_URL = 'https://web.np.playstation.com/api/graphql/v1/op';
export const PS_CATEGORY_GRID_HASH = '9845afc0dbaab4965f6563fffc703f588c8e76792000e8610843b8d3ee9c4c09';
export const PS_DEALS_CATEGORY_ID = '3f772501-f6f8-49b7-abac-874a88ca4897';
export const PS_TOP_GAMES_CATEGORY_ID = '30e3fe35-8f2d-4496-95bc-844f56952e3c';
export const PS_BLOG_RSS_URL = 'https://blog.playstation.com/category/ps-plus/feed/';
export const PS_LOCALE = 'uk-UA';

const PS_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export interface PsMedia {
  type?: string;
  role?: string;
  url?: string;
}

export interface PsSkuPrice {
  basePrice?: string | null;
  discountedPrice?: string | null;
  discountText?: string | null;
  isFree?: boolean | null;
  isExclusive?: boolean | null;
  isTiedToSubscription?: boolean | null;
  serviceBranding?: string[] | null;
}

export interface PsStoreProduct {
  id?: string | null;
  name?: string | null;
  platforms?: string[] | null;
  localizedStoreDisplayClassification?: string | null;
  media?: PsMedia[] | null;
  price?: PsSkuPrice | null;
}

interface PsCategoryGridResponse {
  data?: {
    categoryGridRetrieve?: {
      products?: PsStoreProduct[] | null;
      pageInfo?: {
        totalCount?: number;
      };
    };
  };
  errors?: Array<{ message?: string }>;
}

const IMAGE_ROLE_PRIORITY = [
  'SIXTEEN_BY_NINE_BANNER',
  'GAMEHUB_COVER_ART',
  'EDITION_KEY_ART',
  'MASTER',
  'FOUR_BY_THREE_BANNER',
  'BACKGROUND',
] as const;

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#8211;|&ndash;/gi, '–')
    .replace(/&#8212;|&mdash;/gi, '—')
    .replace(/&#8216;|&#8217;|&lsquo;|&rsquo;/gi, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    });
}

export function parsePsPrice(raw?: string | null): number | undefined {
  if (!raw) return undefined;
  const trimmed = decodeHtmlEntities(raw).trim();
  if (!trimmed) return undefined;
  if (/^(?:безкоштовно|free)$/i.test(trimmed)) return 0;

  // Handle "UAH 2 599,00" or "UAH 1,559.40"
  const numeric = trimmed.replace(/[^\d.,]/g, '');
  if (!numeric) return undefined;

  let normalized = numeric;
  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  if (lastComma > lastDot) {
    // Comma is decimal separator (e.g. "2599,00" or "2.599,00")
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    // Dot is decimal separator (e.g. "2,599.00")
    normalized = normalized.replace(/,/g, '');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : undefined;
}

export function parsePsDiscountPercent(raw?: string | null): number {
  if (!raw) return 0;
  const match = /-?(\d{1,3})\s*%/.exec(raw);
  if (!match) return 0;
  const pct = Number(match[1]);
  return Number.isFinite(pct) && pct > 0 && pct <= 100 ? pct : 0;
}

export function pickPsImage(media?: PsMedia[] | null): string {
  if (!Array.isArray(media) || media.length === 0) return '';
  const images = media.filter(
    (m) => m && m.type === 'IMAGE' && typeof m.url === 'string' && /^https?:\/\//i.test(m.url),
  );
  for (const role of IMAGE_ROLE_PRIORITY) {
    const found = images.find((m) => m.role === role && m.url);
    if (found?.url) return found.url;
  }
  return images[0]?.url ?? '';
}

export function parsePsStoreProduct(
  product: PsStoreProduct,
  opts: { isPopular?: boolean; popularRank?: number; minDiscountPercent: number },
): PlayStationGame | null {
  const id = typeof product.id === 'string' ? product.id.trim() : '';
  const title = typeof product.name === 'string' ? decodeHtmlEntities(product.name).replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  if (!id || !title) return null;

  const platforms = Array.isArray(product.platforms) ? product.platforms : [];
  if (platforms.length > 0 && !platforms.includes('PS5')) return null;

  const basePrice = parsePsPrice(product.price?.basePrice);
  const discountedPrice = parsePsPrice(product.price?.discountedPrice);
  const discountPercent = parsePsDiscountPercent(product.price?.discountText);

  const originalPrice = basePrice ?? discountedPrice;
  const finalPrice = discountedPrice ?? basePrice;
  const isDeal =
    discountPercent >= opts.minDiscountPercent &&
    originalPrice !== undefined &&
    finalPrice !== undefined &&
    finalPrice > 0 &&
    finalPrice <= originalPrice;
  const isPopular = Boolean(opts.isPopular);

  if (!isDeal && !isPopular) return null;

  return {
    id,
    title,
    imageUrl: pickPsImage(product.media),
    url: `https://store.playstation.com/uk-ua/product/${encodeURIComponent(id)}`,
    ...(originalPrice !== undefined ? { originalPrice } : {}),
    ...(finalPrice !== undefined ? { discountPrice: finalPrice } : {}),
    ...(discountPercent > 0 ? { discountPercent } : {}),
    currency: 'UAH',
    isDeal,
    isPopular,
    ...(product.price?.isExclusive ? { isPsPlusExclusive: true } : {}),
    ...(isPopular && opts.popularRank !== undefined ? { popularRank: opts.popularRank } : {}),
  };
}

function slugifyPsTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'game';
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBlogImageUrl(raw: string): string {
  const trimmed = decodeHtmlEntities(raw).trim();
  if (!/^https?:\/\//i.test(trimmed)) return '';
  try {
    const parsed = new URL(trimmed);
    // Drop ?fit=1024,1024 resize query that can produce square crops when full 16:9 exists.
    if (parsed.hostname.endsWith('blog.playstation.com') && parsed.searchParams.has('fit')) {
      parsed.search = '';
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function extractMonthLabel(postTitle: string, pubDate?: string): string {
  const monthMatch =
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i.exec(postTitle);
  const yearMatch = /\b(20\d{2})\b/.exec(pubDate ?? '') ?? /\b(20\d{2})\b/.exec(postTitle);
  if (monthMatch && yearMatch) {
    const m = monthMatch[1][0].toUpperCase() + monthMatch[1].slice(1).toLowerCase();
    return `${m} ${yearMatch[1]}`;
  }
  return monthMatch ? monthMatch[1] : '';
}

function extractRssPostGames(
  contentHtml: string,
  tier: PsPlusTier,
  psPlusMonth: string,
): PlayStationGame[] {
  // Remove modal chrome so "Download the image" / "Close" never pollute titles or descriptions.
  let scope = contentHtml
    .replace(/<div[^>]*class="[^"]*ps-image-modal__wrapper[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, (block) => {
      // Preserve the first <img> inside the modal wrapper before stripping the modal controls!
      const imgM = /<img[^>]+src="([^"]+)"/i.exec(block);
      return imgM ? `<img src="${imgM[1]}">` : '';
    });

  if (tier === 'extra') {
    const extraHeading = /<h[23][^>]*>(?:(?!<\/h[23]>).)*Game Catalog/is.exec(scope);
    if (extraHeading && extraHeading.index >= 0) {
      scope = scope.slice(extraHeading.index);
    }
    const premiumBoundary =
      /<h[23][^>]*>(?:(?!<\/h[23]>).)*(?:PlayStation Plus (?:Premium|Deluxe)|Classics Catalog)/is.exec(scope);
    if (premiumBoundary && premiumBoundary.index > 0) {
      scope = scope.slice(0, premiumBoundary.index);
    }
  } else {
    const lastChanceBoundary = /<h[23][^>]*>(?:(?!<\/h[23]>).)*Last chance to add/is.exec(scope);
    if (lastChanceBoundary && lastChanceBoundary.index > 0) {
      scope = scope.slice(0, lastChanceBoundary.index);
    }
  }

  // Tokenize images, headings, and paragraphs in document order.
  const tokenRe = /<img\b[^>]*\bsrc="([^"]+)"[^>]*>|<(h[234]|p)\b[^>]*>([\s\S]*?)<\/\2>/gi;
  type Token =
    | { kind: 'img'; url: string }
    | { kind: 'block'; tag: string; raw: string; text: string };

  const tokens: Token[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(scope)) !== null) {
    if (m[1]) {
      const url = normalizeBlogImageUrl(m[1]);
      if (url) tokens.push({ kind: 'img', url });
      continue;
    }
    const tag = m[2].toLowerCase();
    const raw = m[3];
    const text = stripTags(raw);
    if (!text) continue;
    if (/^(?:Close|Download (?:the|this) image)$/i.test(text)) continue;
    tokens.push({ kind: 'block', tag, raw, text });
  }

  const results: PlayStationGame[] = [];
  const seenIds = new Set<string>();
  let lastImg = '';

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.kind === 'img') {
      lastImg = tok.url;
      continue;
    }

    // Check if this block is a game heading like "Dead Island 2 | PS5, PS4"
    // Also handle "Close ... Download this image Game Title | PS5" if a modal wrapper wasn't matched.
    const cleanedCandidate = tok.text
      .replace(/^Close\s+Download (?:the|this) image\s*/i, '')
      .trim();

    const titleMatch = /^(.{2,140}?)\s*\|\s*(PS5(?:\s*,\s*PS[45]|,\s*PSVR2)?|PS4\s*,\s*PS5)\s*$/i.exec(
      cleanedCandidate,
    );
    if (!titleMatch) continue;

    // Must explicitly include PS5 in platform list.
    if (!/\bPS5\b/i.test(titleMatch[2])) continue;

    const title = titleMatch[1].trim();
    if (!title || /^PlayStation Plus/i.test(title)) continue;

    const id = `ps_${tier}_${slugifyPsTitle(title)}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    // Look ahead for description paragraph before next game title or heading.
    let description = '';
    for (let j = i + 1; j < Math.min(i + 4, tokens.length); j++) {
      const next = tokens[j];
      if (next.kind === 'img') continue;
      if (next.tag !== 'p') break;
      if (/\|\s*PS[45]/i.test(next.text)) break;
      if (next.text.length >= 25) {
        description = next.text.slice(0, 200);
        break;
      }
    }

    results.push({
      id,
      title,
      imageUrl: lastImg,
      url: `https://store.playstation.com/uk-ua/search/${encodeURIComponent(title)}`,
      ...(description ? { description } : {}),
      isDeal: false,
      isPopular: false,
      psPlusTier: tier,
      ...(psPlusMonth ? { psPlusMonth } : {}),
    });
  }

  return results;
}

export function parsePsBlogRss(xml: string): PlayStationGame[] {
  if (!xml) return [];
  const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  let foundEssential = false;
  let foundExtra = false;
  const games: PlayStationGame[] = [];

  for (const match of itemMatches) {
    if (foundEssential && foundExtra) break;
    const itemXml = match[1];
    const titleRaw = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(itemXml)?.[1] ?? '';
    const postTitle = decodeHtmlEntities(titleRaw).replace(/\s+/g, ' ').trim();
    const pubDate = /<pubDate>([^<]+)<\/pubDate>/i.exec(itemXml)?.[1]?.trim();
    const content =
      /<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/i.exec(itemXml)?.[1] ?? '';
    if (!content) continue;

    if (!foundEssential && /PlayStation Plus Monthly Games/i.test(postTitle)) {
      const month = extractMonthLabel(postTitle, pubDate);
      const parsed = extractRssPostGames(content, 'essential', month);
      if (parsed.length > 0) {
        games.push(...parsed);
        foundEssential = true;
      }
    } else if (!foundExtra && /PlayStation Plus Game Catalog/i.test(postTitle)) {
      const month = extractMonthLabel(postTitle, pubDate);
      const parsed = extractRssPostGames(content, 'extra', month);
      if (parsed.length > 0) {
        games.push(...parsed);
        foundExtra = true;
      }
    }
  }

  return games;
}

export type FetchLike = (url: string, options?: RequestInit) => Promise<Response>;

async function fetchCategoryGrid(
  fetchFn: FetchLike,
  limiter: RateLimiter,
  categoryId: string,
  offset: number,
  size: number,
): Promise<PsStoreProduct[]> {
  await limiter.take();
  const variables = JSON.stringify({
    id: categoryId,
    pageArgs: { size, offset },
    sortBy: { name: 'sales30', isAscending: false },
    filterBy: ['targetPlatforms:PS5', 'storeDisplayClassification:FULL_GAME'],
    facetOptions: [],
  });
  const extensions = JSON.stringify({
    persistedQuery: { version: 1, sha256Hash: PS_CATEGORY_GRID_HASH },
  });
  const url =
    `${PS_GRAPHQL_URL}?operationName=categoryGridRetrieve` +
    `&variables=${encodeURIComponent(variables)}&extensions=${encodeURIComponent(extensions)}`;

  const res = await fetchFn(url, {
    headers: {
      'User-Agent': PS_USER_AGENT,
      'x-psn-store-locale-override': PS_LOCALE,
      'Accept-Language': PS_LOCALE,
      'content-type': 'application/json',
      Accept: 'application/json',
    },
  });
  const data = (await res.json()) as PsCategoryGridResponse;
  if (data.errors && data.errors.length > 0 && !data.data?.categoryGridRetrieve) {
    throw new Error(`PS Store GraphQL error: ${data.errors[0]?.message ?? 'unknown'}`);
  }
  const products = data.data?.categoryGridRetrieve?.products;
  if (!Array.isArray(products)) {
    throw new Error('PS Store GraphQL returned invalid products payload');
  }
  return products;
}

export async function fetchPlayStationGames(
  fetchFn: FetchLike,
  limiter: RateLimiter,
  opts: { minDiscountPercent: number },
): Promise<PlayStationGame[]> {
  const [dealsRes, topRes, rssRes] = await Promise.allSettled([
    (async () => {
      const page0 = await fetchCategoryGrid(fetchFn, limiter, PS_DEALS_CATEGORY_ID, 0, 36);
      const page1 = await fetchCategoryGrid(fetchFn, limiter, PS_DEALS_CATEGORY_ID, 36, 36);
      return [...page0, ...page1];
    })(),
    fetchCategoryGrid(fetchFn, limiter, PS_TOP_GAMES_CATEGORY_ID, 0, 24),
    (async () => {
      await limiter.take();
      const res = await fetchFn(PS_BLOG_RSS_URL, {
        headers: { 'User-Agent': PS_USER_AGENT, Accept: 'application/rss+xml, application/xml, text/xml' },
      });
      return parsePsBlogRss(await res.text());
    })(),
  ]);

  const anySucceeded =
    dealsRes.status === 'fulfilled' || topRes.status === 'fulfilled' || rssRes.status === 'fulfilled';
  if (!anySucceeded) {
    throw new Error('All PlayStation sub-sources failed');
  }

  const byId = new Map<string, PlayStationGame>();

  if (dealsRes.status === 'fulfilled') {
    for (const product of dealsRes.value) {
      const parsed = parsePsStoreProduct(product, {
        isPopular: false,
        minDiscountPercent: opts.minDiscountPercent,
      });
      if (parsed && !byId.has(parsed.id)) {
        byId.set(parsed.id, parsed);
      }
    }
  }

  if (topRes.status === 'fulfilled') {
    topRes.value.forEach((product, idx) => {
      const parsed = parsePsStoreProduct(product, {
        isPopular: true,
        popularRank: idx + 1,
        minDiscountPercent: opts.minDiscountPercent,
      });
      if (!parsed) return;
      const existing = byId.get(parsed.id);
      if (existing) {
        existing.isPopular = true;
        existing.popularRank = existing.popularRank ?? parsed.popularRank;
        if ((parsed.discountPercent ?? 0) > (existing.discountPercent ?? 0)) {
          existing.discountPercent = parsed.discountPercent;
          existing.originalPrice = parsed.originalPrice;
          existing.discountPrice = parsed.discountPrice;
          existing.isDeal = existing.isDeal || parsed.isDeal;
        }
        if (parsed.isPsPlusExclusive) existing.isPsPlusExclusive = true;
      } else {
        byId.set(parsed.id, parsed);
      }
    });
  }

  const result = [...byId.values()];
  if (rssRes.status === 'fulfilled') {
    for (const subGame of rssRes.value) {
      if (!byId.has(subGame.id)) {
        result.push(subGame);
      }
    }
  }

  return result;
}
