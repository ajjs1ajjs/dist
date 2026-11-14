import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chooseSteamSnapshot, isValidSteamSearchPage, selectSteamNotifications, updatePriceHistory } from './collector-core';
import { parseSearchHtml } from './fetch-deals';
import { writeJsonAtomically } from './persistence';
import { buildTelegramBatches } from './telegram';
import type { SteamGame } from './types';

test('price history retains the daily minimum and does not record failed fetches', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  const game: SteamGame = { id: '123', title: 'Game', imageUrl: '', originalPrice: 10, discountPrice: 5, discountPercent: 50, currency: 'UAH', url: 'https://store.steampowered.com/app/123', isSpecial: true, isFree: false, isPopular: false };
  const first = updatePriceHistory({}, [game], now, true);
  const second = updatePriceHistory(first, [{ ...game, discountPrice: 9 }], now, true);
  assert.equal(second['123'][0].price, 5);
  assert.deepEqual(updatePriceHistory(second, [], now, false), second);
});

test('prepare refuses to overwrite a damaged catalog or damaged price history', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sales-history-safety-'));
  try {
    const target = path.join(directory, 'deals.json');
    for (const contents of ['{broken', JSON.stringify({ steam: [], priceHistory: [] })]) {
      await writeFile(target, contents);
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'fetch-deals.ts', '--prepare'], {
        cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, DEALS_DIR: directory }, timeout: 5000,
      });
      assert.notEqual(result.status, 0);
      assert.equal(await readFile(target, 'utf8'), contents);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an incomplete Steam search page is invalid and retains the last known snapshot', () => {
  assert.equal(isValidSteamSearchPage({ success: 1, results_html: '' }), true);
  assert.equal(isValidSteamSearchPage({ success: 0, results_html: '<div>partial</div>' }), false);
  assert.equal(isValidSteamSearchPage({ success: 1 }), false);

  const previous: SteamGame[] = [{
    id: 'known-good', title: 'Known Good', imageUrl: '', originalPrice: 10,
    discountPrice: 5, discountPercent: 50, currency: 'USD',
    url: 'https://store.steampowered.com/app/1', isSpecial: true, isFree: false, isPopular: false,
  }];
  assert.deepEqual(chooseSteamSnapshot([], previous, false), { games: previous, usedPrevious: true });
});

test('Telegram batches preserve complete items and stay within count and length bounds', () => {
  const items = Array.from({ length: 11 }, (_, index) => `offer-${index}`);
  const batches = buildTelegramBatches(items, '<b>Deals</b>\n', '\nFooter', (item) => `<b>${item}</b>`, 70, 4);
  assert.deepEqual(batches.flatMap((batch) => batch.items), items);
  for (const batch of batches) {
    assert.ok(batch.text.length <= 70);
    assert.ok(batch.items.length <= 4);
    assert.ok(batch.text.startsWith('<b>Deals</b>\n'));
    assert.ok(batch.text.endsWith('\nFooter'));
  }
  assert.throws(() => buildTelegramBatches(['too-long'], '', '', () => 'x'.repeat(10), 9), /exceeds/);
});

test('atomic JSON persistence leaves one complete snapshot and no temporary files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dist-sales-fetch-'));
  try {
    const target = path.join(directory, 'history.json');
    const expected = { delivered: ['one'], lastUpdated: '2026-10-28T00:00:00.000Z' };
    await writeJsonAtomically(target, expected);
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), expected);
    assert.deepEqual(await readdir(directory), ['history.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('parseSearchHtml handles Steam discount_pct attributes and selectSteamNotifications allows price drops while skipping queued keys', () => {
  const html = `
    <a href="https://store.steampowered.com/app/777/" data-ds-appid="777" data-ds-itemkey="App_777">
      <div class="col search_capsule"><img src="https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/777/capsule_sm_120.jpg?t=1"></div>
      <span class="title" dir="auto">Attribute Game</span>
      <div class="discount_block search_discount_block" data-price-final="10000" data-bundlediscount="0" data-discount="75">
        <div class="discount_pct" aria-hidden="true" data-tooltip-text="Тимчасова знижка, що зменшує звичайну ціну.">-75%</div>
        <div class="discount_prices" aria-hidden="true">
          <div class="discount_original_price" aria-hidden="true">400,00₴</div>
          <div class="discount_final_price">100,00₴</div>
        </div>
      </div>
    </a>`;
  const games = new Map<string, SteamGame>();
  assert.equal(parseSearchHtml(html, games), 1);
  const parsed = games.get('777');
  assert.ok(parsed);
  assert.equal(parsed.discountPercent, 75);
  assert.equal(parsed.originalPrice, 400);
  assert.equal(parsed.discountPrice, 100);

  const now = new Date('2026-11-14T12:00:00.000Z');
  const history = {
    steam_discount_777: { title: 'Attribute Game', price: 200, percent: 50, timestamp: '2026-11-10T12:00:00.000Z', type: 'discount' as const },
  };
  const queuedGame: SteamGame = { ...parsed, id: '888', title: 'Queued Game', discountPercent: 90 };
  const selection = selectSteamNotifications([parsed, queuedGame], history, new Set(['steam_discount_888']), now, {
    minDiscountPercent: 25,
    freeCooldownMs: 14 * 24 * 60 * 60 * 1000,
    discountCooldownMs: 30 * 24 * 60 * 60 * 1000,
    maxDealsPerRun: 1,
  });
  assert.deepEqual(selection.deals.map((g) => g.id), ['777']);
});
