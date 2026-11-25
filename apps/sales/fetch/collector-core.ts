import type { GamePassGame, NotifiedItem, PlayStationGame, PriceObservation, SteamGame } from './types';
import { isPriceTrackedId } from './format';

export interface SteamNotificationOptions {
  minDiscountPercent: number;
  freeCooldownMs: number;
  discountCooldownMs: number;
  maxDealsPerRun: number;
  maxDlcPerRun?: number;
}

export interface SteamMetadata {
  type?: number;
  parentAppId?: string;
  reviewCount?: number;
  reviewPercent?: number;
  reviewLabel?: string;
  releaseTimeSec?: number;
}

export interface SteamQualityOptions {
  minDiscountPercent: number;
  topSellerMinDiscountPercent: number;
  minReviewPercent: number;
  minReviewCount: number;
  newReleaseDays: number;
  newReleaseMinReviews: number;
  popularMinReviewPercent: number;
  popularMinReviewCount: number;
  dlcMinDiscountPercent: number;
  dlcMinReviewCount: number;
  dlcMinReviewPercent: number;
  dlcMinOriginalPriceUah: number;
}

const DLC_JUNK_RE =
  /(?:\bsoundtrack\b|\bost\b|\bart\s*book\b|\bwallpaper|\bskin\s*pack\b|\bsupporter\s*pack\b|\bcosmetic|\bcoins\b|\bpoints\b|\bcurrency\b|\bstarter\s*pack\b|\bseason\s*pass\b|\bmusic\b|\bdigital\s*art\b)/i;

/**
 * Filter Steam games & DLCs by review quality, popularity, and discount depth so
 * obscure shovelware and low-value cosmetic/OST DLCs are excluded.
 */
export function filterQualitySteamGames(
  games: SteamGame[],
  metaMap: ReadonlyMap<string, SteamMetadata>,
  now: Date,
  opts: SteamQualityOptions,
): SteamGame[] {
  const nowSec = Math.floor(now.getTime() / 1000);
  const newCutoffSec = nowSec - opts.newReleaseDays * 86400;
  const enriched: SteamGame[] = [];

  for (const game of games) {
    const meta = metaMap.get(game.id);
    if (meta?.type !== undefined && meta.type !== 0 && meta.type !== 4) continue;
    const isDlc = Boolean(game.isDlc || meta?.type === 4);
    const reviewCount = meta?.reviewCount ?? game.reviewCount;
    const reviewPercent = meta?.reviewPercent ?? game.reviewPercent;
    const reviewLabel = meta?.reviewLabel ?? game.reviewLabel;
    const parentAppId = meta?.parentAppId ?? game.parentAppId;
    const isNewRelease = Boolean(meta?.releaseTimeSec && meta.releaseTimeSec >= newCutoffSec);

    const updated: SteamGame = {
      ...game,
      ...(isDlc ? { isDlc: true } : {}),
      ...(parentAppId ? { parentAppId } : {}),
      ...(reviewCount !== undefined ? { reviewCount } : {}),
      ...(reviewPercent !== undefined ? { reviewPercent } : {}),
      ...(reviewLabel ? { reviewLabel } : {}),
    };

    if (game.isFree) {
      if (isDlc && DLC_JUNK_RE.test(game.title)) continue;
      enriched.push(updated);
      continue;
    }

    if (isDlc) {
      if (DLC_JUNK_RE.test(game.title)) continue;
      if (updated.discountPercent < opts.dlcMinDiscountPercent) continue;
      if (updated.currency === 'UAH' && updated.originalPrice < opts.dlcMinOriginalPriceUah) continue;
      if (reviewCount !== undefined && reviewCount < opts.dlcMinReviewCount) continue;
      if (reviewPercent !== undefined && reviewPercent < opts.dlcMinReviewPercent) continue;
      updated.isSpecial = true;
      updated.isPopular = false;
      enriched.push(updated);
      continue;
    }

    const minNeededReviews = isNewRelease ? opts.newReleaseMinReviews : opts.minReviewCount;
    const passesPopularReviews =
      (reviewCount === undefined || reviewCount >= opts.popularMinReviewCount) &&
      (reviewPercent === undefined || reviewPercent >= opts.popularMinReviewPercent);
    const passesDealReviews =
      (reviewCount === undefined || reviewCount >= minNeededReviews) &&
      (reviewPercent === undefined || reviewPercent >= opts.minReviewPercent);

    const isGenuinePopular = Boolean(updated.isPopular && passesPopularReviews);
    const effectiveMinDiscount = isGenuinePopular
      ? opts.topSellerMinDiscountPercent
      : opts.minDiscountPercent;
    const isQualitySpecial = Boolean(
      updated.isSpecial &&
        updated.discountPercent >= effectiveMinDiscount &&
        passesDealReviews,
    );

    if (!isGenuinePopular && !isQualitySpecial) continue;

    updated.isPopular = isGenuinePopular;
    updated.isSpecial = isQualitySpecial;
    enriched.push(updated);
  }

  return enriched.sort((a, b) => {
    if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
    const rankA = a.popularRank ?? Number.POSITIVE_INFINITY;
    const rankB = b.popularRank ?? Number.POSITIVE_INFINITY;
    if (rankA !== rankB) return rankA - rankB;
    const scoreA =
      (a.discountPercent || 0) +
      Math.log10(Math.max(10, a.reviewCount ?? 10)) * 8 +
      ((a.reviewPercent ?? 70) - 70) * 0.4;
    const scoreB =
      (b.discountPercent || 0) +
      Math.log10(Math.max(10, b.reviewCount ?? 10)) * 8 +
      ((b.reviewPercent ?? 70) - 70) * 0.4;
    return scoreB - scoreA;
  });
}

/**
 * Select Steam free offers, hot base-game discounts, and major DLC discounts eligible for Telegram notification.
 * Excludes items already queued in the outbox before applying the per-run cap so
 * pending messages do not consume slots, while allowing 14-day freebie repeats
 * and >=5% price drops even when a prior 30-day history entry still exists.
 */
export function selectSteamNotifications(
  games: SteamGame[],
  notifiedHistory: Record<string, NotifiedItem>,
  queuedKeys: ReadonlySet<string>,
  now: Date,
  opts: SteamNotificationOptions,
): { freeGames: SteamGame[]; deals: SteamGame[]; dlcDeals: SteamGame[] } {
  const nowMs = now.getTime();
  const freeGames: SteamGame[] = [];
  const deals: SteamGame[] = [];
  const dlcDeals: SteamGame[] = [];

  for (const game of games) {
    if (game.isFree) {
      const key = `steam_free_${game.id}`;
      if (!queuedKeys.has(key)) {
        const entry = notifiedHistory[key];
        const lastMs = entry ? Date.parse(entry.timestamp) : NaN;
        if (!entry || Number.isNaN(lastMs) || nowMs - lastMs > opts.freeCooldownMs) {
          freeGames.push(game);
        }
      }
    }

    // Free games are announced exclusively via the free branch above.
    if (!game.isFree && game.isSpecial && game.discountPercent >= opts.minDiscountPercent) {
      const isDlc = Boolean(game.isDlc);
      const key = isDlc ? `steam_dlc_${game.id}` : `steam_discount_${game.id}`;
      if (queuedKeys.has(key)) continue;
      const entry = notifiedHistory[key];
      const eligible = (() => {
        if (!entry) return true;
        const lastMs = Date.parse(entry.timestamp);
        const priceDropped = game.discountPrice < entry.price * 0.95;
        const cooldownExpired = Number.isNaN(lastMs) || nowMs - lastMs > opts.discountCooldownMs;
        return priceDropped || cooldownExpired;
      })();
      if (eligible) {
        if (isDlc) dlcDeals.push(game);
        else deals.push(game);
      }
    }
  }

  const dealScore = (g: SteamGame): number =>
    (g.isPopular ? 30 : 0) +
    g.discountPercent +
    Math.log10(Math.max(10, g.reviewCount ?? 10)) * 10;

  const sortDeals = (list: SteamGame[]) =>
    list.sort(
      (a, b) =>
        dealScore(b) - dealScore(a) ||
        (a.popularRank ?? 999) - (b.popularRank ?? 999) ||
        b.discountPercent - a.discountPercent ||
        (b.reviewCount ?? 0) - (a.reviewCount ?? 0),
    );

  sortDeals(deals);
  sortDeals(dlcDeals);

  return {
    freeGames,
    deals: deals.slice(0, opts.maxDealsPerRun),
    dlcDeals: dlcDeals.slice(0, opts.maxDlcPerRun ?? opts.maxDealsPerRun),
  };
}

/** Split top-tier Steam mega-hits (>=50% off, >=5000 reviews, >=80% positive) for individual hero cards. */
export function partitionMegaSteamDeals(
  deals: SteamGame[],
  maxMega = 3,
): { megaDeals: SteamGame[]; digestDeals: SteamGame[] } {
  const megaDeals: SteamGame[] = [];
  const digestDeals: SteamGame[] = [];

  for (const deal of deals) {
    const isMega =
      megaDeals.length < maxMega &&
      deal.discountPercent >= 50 &&
      (deal.reviewCount ?? 0) >= 5000 &&
      (deal.reviewPercent ?? 0) >= 80;
    if (isMega) megaDeals.push(deal);
    else digestDeals.push(deal);
  }

  return { megaDeals, digestDeals };
}

/** Daily observations of prices actually seen in the sampled Steam and PlayStation catalogs. */
export function updatePriceHistory(
  raw: unknown,
  games: SteamGame[],
  now: Date,
  steamUpdated: boolean,
  playstation: PlayStationGame[] = [],
  playstationUpdated = false,
): Record<string, PriceObservation[]> {
  const cutoff = new Date(now.getTime() - 89 * 86400000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const history: Record<string, PriceObservation[]> = Object.create(null);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, entries] of Object.entries(raw)) {
      if (!isPriceTrackedId(id) || !Array.isArray(entries)) continue;
      const valid = entries.filter(
        (entry): entry is PriceObservation =>
          !!entry &&
          typeof entry === 'object' &&
          typeof entry.date === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(entry.date) &&
          entry.date >= cutoff &&
          entry.date <= today &&
          typeof entry.price === 'number' &&
          Number.isFinite(entry.price) &&
          entry.price >= 0 &&
          typeof entry.currency === 'string' &&
          /^[A-Z]{3}$/.test(entry.currency),
      );
      if (valid.length) history[id] = valid.sort((a, b) => a.date.localeCompare(b.date)).slice(-182);
    }
  }
  const recordObservation = (id: string, price: number, currency: string) => {
    if (!isPriceTrackedId(id) || !Number.isFinite(price) || price < 0 || !/^[A-Z]{3}$/.test(currency)) return;
    const previous = history[id] ?? [];
    const sameDay = previous.find((item) => item.date === today && item.currency === currency);
    const minPrice = sameDay ? Math.min(sameDay.price, price) : price;
    history[id] = [
      ...previous.filter((item) => item.date !== today || item.currency !== currency),
      { date: today, price: minPrice, currency },
    ].slice(-182);
  };
  if (steamUpdated) {
    for (const game of games) {
      recordObservation(game.id, game.discountPrice, game.currency);
    }
  }
  if (playstationUpdated) {
    for (const game of playstation) {
      if (typeof game.discountPrice === 'number' && game.currency) {
        recordObservation(game.id, game.discountPrice, game.currency);
      }
    }
  }
  return history;
}

export function isValidSteamSearchPage(data: { success?: number; results_html?: unknown }): data is { success: number; results_html: string; total_count?: number } {
  return data.success === 1 && typeof data.results_html === 'string';
}

export function chooseSteamSnapshot(
  fresh: SteamGame[],
  previous: SteamGame[],
  fetchSucceeded: boolean,
): { games: SteamGame[]; usedPrevious: boolean } {
  if (previous.length > 0 && (!fetchSucceeded || fresh.length === 0)) {
    return { games: previous, usedPrevious: true };
  }
  return { games: fresh, usedPrevious: false };
}

export function planGamePassNewEntries(games: GamePassGame[], history: Record<string, unknown>): GamePassGame[] {
  const hasNewBaseline = Object.keys(history).some(
    (key) => key.startsWith('gamepass_') && !key.startsWith('gamepass_popular_') && !key.startsWith('gamepass_deal_'),
  );
  if (!hasNewBaseline) return [];
  return games.filter((game) => game.isNew && !history[`gamepass_${game.id}`]);
}

export function planGamePassPopularEntries(games: GamePassGame[], history: Record<string, unknown>): GamePassGame[] {
  const hasPopularBaseline = Object.keys(history).some((key) => key.startsWith('gamepass_popular_'));
  if (!hasPopularBaseline) return [];
  return games.filter((game) => game.isPopular && !history[`gamepass_popular_${game.id}`]);
}

export function planGamePassDealNotifications(
  games: GamePassGame[],
  history: Record<string, NotifiedItem>,
  queuedKeys: ReadonlySet<string>,
  now: Date,
  opts: { minDiscountPercent: number; discountCooldownMs: number; maxDealsPerRun: number },
): GamePassGame[] {
  const nowMs = now.getTime();
  const deals: GamePassGame[] = [];

  for (const game of games) {
    if (!game.isDeal || (game.discountPercent ?? 0) < opts.minDiscountPercent) continue;
    if (typeof game.discountPrice !== 'number' || game.discountPrice <= 0) continue;
    const key = `gamepass_deal_${game.id}`;
    if (queuedKeys.has(key)) continue;
    const entry = history[key];
    if (!entry) {
      deals.push(game);
      continue;
    }
    const lastMs = Date.parse(entry.timestamp);
    const priceDropped = game.discountPrice < entry.price * 0.95;
    const cooldownExpired = Number.isNaN(lastMs) || nowMs - lastMs > opts.discountCooldownMs;
    if (priceDropped || cooldownExpired) {
      deals.push(game);
    }
  }

  deals.sort(
    (a, b) =>
      (b.isPopular ? 1 : 0) - (a.isPopular ? 1 : 0) ||
      (b.discountPercent ?? 0) - (a.discountPercent ?? 0),
  );

  return deals.slice(0, opts.maxDealsPerRun);
}

export function choosePlayStationSnapshot(
  fresh: PlayStationGame[],
  previous: PlayStationGame[],
  fetchSucceeded: boolean,
): { games: PlayStationGame[]; usedPrevious: boolean } {
  if (previous.length > 0 && (!fetchSucceeded || fresh.length === 0)) {
    return { games: previous, usedPrevious: true };
  }
  return { games: fresh, usedPrevious: false };
}

export function planPlayStationNotifications(
  games: PlayStationGame[],
  history: Record<string, NotifiedItem>,
  queuedKeys: ReadonlySet<string>,
  now: Date,
  opts: { minDiscountPercent: number; discountCooldownMs: number; maxDealsPerRun: number },
): { essential: PlayStationGame[]; extra: PlayStationGame[]; deals: PlayStationGame[] } {
  const nowMs = now.getTime();
  const hasEssentialBaseline = Object.keys(history).some((k) => k.startsWith('ps_essential_'));
  const hasExtraBaseline = Object.keys(history).some((k) => k.startsWith('ps_extra_'));

  const essential = hasEssentialBaseline
    ? games.filter((g) => g.psPlusTier === 'essential' && !history[g.id] && !queuedKeys.has(g.id))
    : [];
  const extra = hasExtraBaseline
    ? games.filter((g) => g.psPlusTier === 'extra' && !history[g.id] && !queuedKeys.has(g.id))
    : [];

  const indexedDeals: Array<{ game: PlayStationGame; idx: number }> = [];
  for (let idx = 0; idx < games.length; idx++) {
    const game = games[idx];
    if (!game.isDeal || (game.discountPercent ?? 0) < opts.minDiscountPercent) continue;
    if (typeof game.discountPrice !== 'number' || game.discountPrice <= 0) continue;
    const key = `ps_deal_${game.id}`;
    if (queuedKeys.has(key)) continue;
    const entry = history[key];
    if (!entry) {
      indexedDeals.push({ game, idx });
      continue;
    }
    const lastMs = Date.parse(entry.timestamp);
    const priceDropped = game.discountPrice < entry.price * 0.95;
    const cooldownExpired = Number.isNaN(lastMs) || nowMs - lastMs > opts.discountCooldownMs;
    if (priceDropped || cooldownExpired) {
      indexedDeals.push({ game, idx });
    }
  }

  indexedDeals.sort(
    (a, b) =>
      (a.game.isPopular ? 0 : 1) - (b.game.isPopular ? 0 : 1) ||
      (a.game.popularRank ?? 999) - (b.game.popularRank ?? 999) ||
      a.idx - b.idx ||
      (b.game.discountPercent ?? 0) - (a.game.discountPercent ?? 0),
  );

  const deals = indexedDeals.map((entry) => entry.game);

  return {
    essential,
    extra,
    deals: deals.slice(0, opts.maxDealsPerRun),
  };
}

export interface CatalogUpdateTimestamps {
  lastUpdated: string;
  sourceUpdates: {
    steam?: string;
    gamepass?: string;
    playstation?: string;
  };
}

export function resolveCatalogTimestamps(params: {
  nowIso: string;
  oldData: {
    lastUpdated?: string;
    sourceUpdates?: { steam?: string; gamepass?: string; playstation?: string };
    steam?: unknown[];
    gamepass?: unknown[];
    playstation?: unknown[];
  };
  steamUpdated: boolean;
  gamepassUpdated: boolean;
  playstationUpdated?: boolean;
}): CatalogUpdateTimestamps {
  const oldSteam =
    params.oldData.sourceUpdates?.steam ||
    (params.oldData.steam && params.oldData.steam.length > 0 ? params.oldData.lastUpdated : undefined);
  const oldGamepass =
    params.oldData.sourceUpdates?.gamepass ||
    (params.oldData.gamepass && params.oldData.gamepass.length > 0 ? params.oldData.lastUpdated : undefined);
  const oldPlaystation =
    params.oldData.sourceUpdates?.playstation ||
    (params.oldData.playstation && params.oldData.playstation.length > 0 ? params.oldData.lastUpdated : undefined);

  const steam = params.steamUpdated ? params.nowIso : oldSteam;
  const gamepass = params.gamepassUpdated ? params.nowIso : oldGamepass;
  const playstation = params.playstationUpdated ? params.nowIso : oldPlaystation;

  // When all sources fail or keep previous catalogs, preserve old lastUpdated
  let lastUpdated = params.oldData.lastUpdated || '';
  if (params.steamUpdated || params.gamepassUpdated || params.playstationUpdated) {
    lastUpdated = params.nowIso;
  }

  return {
    lastUpdated,
    sourceUpdates: {
      ...(steam ? { steam } : {}),
      ...(gamepass ? { gamepass } : {}),
      ...(playstation ? { playstation } : {}),
    },
  };
}
