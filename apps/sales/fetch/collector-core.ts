import type { GamePassGame, SteamGame, PriceObservation } from './types';

/** Daily observations of prices actually seen in the sampled Steam catalog. */
export function updatePriceHistory(raw: unknown, games: SteamGame[], now: Date, steamUpdated: boolean): Record<string, PriceObservation[]> {
  const cutoff = new Date(now.getTime() - 89 * 86400000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const history: Record<string, PriceObservation[]> = Object.create(null);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, entries] of Object.entries(raw)) {
      if (!/^\d+$/.test(id) || !Array.isArray(entries)) continue;
      const valid = entries.filter((entry): entry is PriceObservation => !!entry && typeof entry === 'object' && typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && entry.date >= cutoff && entry.date <= today && typeof entry.price === 'number' && Number.isFinite(entry.price) && entry.price >= 0 && typeof entry.currency === 'string' && /^[A-Z]{3}$/.test(entry.currency));
      if (valid.length) history[id] = valid.sort((a, b) => a.date.localeCompare(b.date)).slice(-182);
    }
  }
  if (steamUpdated) for (const game of games) {
    if (!/^\d+$/.test(game.id) || !Number.isFinite(game.discountPrice) || game.discountPrice < 0 || !/^[A-Z]{3}$/.test(game.currency)) continue;
    const previous = history[game.id] ?? [];
    const sameDay = previous.find(item => item.date === today && item.currency === game.currency);
    const price = sameDay ? Math.min(sameDay.price, game.discountPrice) : game.discountPrice;
    history[game.id] = [...previous.filter(item => item.date !== today || item.currency !== game.currency), { date: today, price, currency: game.currency }].slice(-182);
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
  const hasNewBaseline = Object.keys(history).some((key) => key.startsWith('gamepass_') && !key.startsWith('gamepass_popular_'));
  if (!hasNewBaseline) return [];
  return games.filter((game) => game.isNew && !history[`gamepass_${game.id}`]);
}

export function planGamePassPopularEntries(games: GamePassGame[], history: Record<string, unknown>): GamePassGame[] {
  const hasPopularBaseline = Object.keys(history).some((key) => key.startsWith('gamepass_popular_'));
  if (!hasPopularBaseline) return [];
  return games.filter((game) => game.isPopular && !history[`gamepass_popular_${game.id}`]);
}

export interface CatalogUpdateTimestamps {
  lastUpdated: string;
  sourceUpdates: {
    steam?: string;
    gamepass?: string;
  };
}

export function resolveCatalogTimestamps(params: {
  nowIso: string;
  oldData: {
    lastUpdated?: string;
    sourceUpdates?: { steam?: string; gamepass?: string };
    steam?: unknown[];
    gamepass?: unknown[];
  };
  steamUpdated: boolean;
  gamepassUpdated: boolean;
}): CatalogUpdateTimestamps {
  const oldSteam =
    params.oldData.sourceUpdates?.steam ||
    (params.oldData.steam && params.oldData.steam.length > 0 ? params.oldData.lastUpdated : undefined);
  const oldGamepass =
    params.oldData.sourceUpdates?.gamepass ||
    (params.oldData.gamepass && params.oldData.gamepass.length > 0 ? params.oldData.lastUpdated : undefined);

  const steam = params.steamUpdated ? params.nowIso : oldSteam;
  const gamepass = params.gamepassUpdated ? params.nowIso : oldGamepass;

  // When both sources fail or keep previous catalogs, preserve old lastUpdated
  let lastUpdated = params.oldData.lastUpdated || '';
  if (params.steamUpdated || params.gamepassUpdated) {
    lastUpdated = params.nowIso;
  }

  return {
    lastUpdated,
    sourceUpdates: {
      ...(steam ? { steam } : {}),
      ...(gamepass ? { gamepass } : {}),
    },
  };
}
