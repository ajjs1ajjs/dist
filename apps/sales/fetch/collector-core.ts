import type { GamePassGame, SteamGame } from './types';

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
