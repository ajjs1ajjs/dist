import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = source.indexOf('  function compareVersions(a, b)');
const end = source.indexOf('  /* ---------- Boot ---------- */', start);
assert.ok(start >= 0 && end > start);

async function run(latest) {
  const version = { dataset: { latestVer: 'bck-v' }, textContent: 'v1.2.2' };
  const link = { dataset: { latestHref: 'bck-v' }, href: 'https://example.test/old' };
  const code = { dataset: { latestCode: 'bck-v' }, textContent: 'old.tar.gz' };
  const calls = [];
  const ctx = {
    URL, document: { currentScript: { src: 'https://example.test/dist/app.js?v=1' } },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    $$: selector => ({ '[data-latest-ver]': [version], '[data-latest-href]': [link], '[data-latest-code]': [code] })[selector] || [],
    fetch: async url => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ schemaVersion: 1, latest }) };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end) + '\nglobalThis.run = syncLatestReleases;', ctx);
  await ctx.run();
  return { version, link, code, calls };
}

test('detail pages load the release manifest and update only accepted releases', async () => {
  const missing = await run({});
  assert.equal(missing.calls[0], 'https://example.test/dist/releases.json');
  assert.equal(missing.version.textContent, 'v1.2.2');
  assert.equal(missing.link.href, 'https://example.test/old');
  const url = 'https://github.com/ajjs1ajjs/dist/releases/download/bck-v1.2.3/bck-linux-x86_64.tar.gz';
  const complete = await run({ 'bck-v': { version: 'v1.2.3', downloadUrl: url, name: 'bck-linux-x86_64.tar.gz' } });
  assert.equal(complete.version.textContent, 'v1.2.3');
  assert.equal(complete.link.href, url);
});

test('buy modal opens via HTMLDialogElement and filter counts populate without {n}', () => {
  const listeners = [];
  const chips = [
    { dataset: { filter: 'all', filterCount: 'all', i18n: 'prod.filterAll' }, textContent: '', classList: { toggle() {} }, setAttribute() {} },
    { dataset: { filter: 'linux', filterCount: 'linux', i18n: 'prod.filterLinux' }, textContent: '', classList: { toggle() {} }, setAttribute() {} },
  ];
  const cards = [
    { dataset: { cat: 'linux' }, textContent: 'BCK', querySelector: () => null, classList: { toggle() {}, contains: () => false } },
    { dataset: { cat: 'windows' }, textContent: 'RDM', querySelector: () => null, classList: { toggle() {}, contains: () => false } },
  ];
  class Dialog {
    constructor() { this.dataset = {}; this.open = false; this.shown = false; }
    querySelector() { return { focus() {} }; }
    addEventListener() {}
    showModal() { this.open = true; this.shown = true; }
    close() { this.open = false; }
  }
  const nodes = {
    buyModal: new Dialog(),
    buyName: { textContent: '' },
    buyMonth: { textContent: '' },
    buyYear: { textContent: '' },
    buyMonthLink: { href: '' },
    buyYearLink: { href: '' },
    buyEmail: { href: '' },
    resultCount: { textContent: '' },
    productGrid: { querySelectorAll: () => cards, append() {} },
  };
  const noop = () => {};
  const document = {
    currentScript: { src: 'https://example.test/dist/app.js?v=1' },
    querySelector: (selector) => nodes[selector.slice(1)] || null,
    querySelectorAll: (selector) => {
      if (selector === '.chip[data-filter]') return chips;
      if (selector === '[data-filter-count]') return chips;
      return [];
    },
    getElementById: (id) => nodes[id] || null,
    addEventListener: (type, listener) => { if (type === 'click') listeners.push(listener); },
    documentElement: {},
    body: { dataset: {}, style: {} },
    activeElement: { focus: noop },
  };
  const ctx = {
    URL,
    document,
    window: {
      SITE_I18N: {
        uk: {
          'prod.filterAll': 'Всі · {n}',
          'prod.filterLinux': '🐧 Linux · {n}',
          'prod.count': 'Показано {n} з {total}',
          'buy.moSuffix': 'міс',
          'buy.yrSuffix': 'рік',
        },
      },
    },
    HTMLDialogElement: Dialog,
    localStorage: { getItem: () => null, setItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop },
    location: { search: '', pathname: '/', hash: '' },
    addEventListener: noop,
    fetch: async () => ({ ok: true, json: async () => ({ schemaVersion: 1, latest: {} }) }),
    setTimeout,
    clearTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);

  assert.equal(chips[0].textContent, 'Всі · 2');
  assert.equal(chips[1].textContent, '🐧 Linux · 1');
  assert.doesNotMatch(chips[0].textContent, /\{n\}/);
  assert.equal(nodes.resultCount.textContent, 'Показано 2 з 2');

  const buyBtn = { dataset: { name: 'BCK', month: '2500', year: '28000' } };
  const event = { target: { closest: (sel) => sel === '[data-buy]' ? buyBtn : null }, preventDefault: noop };
  for (const listener of listeners) listener(event);
  assert.equal(nodes.buyModal.shown, true);
  assert.equal(nodes.buyModal.open, true);
  assert.equal(nodes.buyName.textContent, 'BCK');
  assert.equal(nodes.buyMonth.textContent, '2 500 ₴ / міс');
});
