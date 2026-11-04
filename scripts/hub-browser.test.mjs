import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = source.indexOf('  async function syncLatestReleases()');
const end = source.indexOf('  /* ---------- Boot ---------- */', start);
assert.ok(start >= 0 && end > start);

async function run(assets) {
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
      if (calls.length === 1) return { ok: true, json: async () => ({ products: [{ prefix: 'bck-v', assetPattern: 'linux.*\\.tar\\.gz$' }] }) };
      return { ok: true, json: async () => [{ tag_name: 'bck-v1.2.3', assets }] };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end) + '\nglobalThis.run = syncLatestReleases;', ctx);
  await ctx.run();
  return { version, link, code, calls };
}

test('detail pages load the canonical catalog relative to the script and update only complete releases', async () => {
  const missing = await run([]);
  assert.equal(missing.calls[0], 'https://example.test/dist/apps/catalog.json');
  assert.equal(missing.version.textContent, 'v1.2.2');
  assert.equal(missing.link.href, 'https://example.test/old');
  const url = 'https://github.com/ajjs1ajjs/dist/releases/download/bck-v1.2.3/bck-linux-x86_64.tar.gz';
  const complete = await run([{ name: 'bck-linux-x86_64.tar.gz', browser_download_url: url }]);
  assert.equal(complete.version.textContent, 'v1.2.3');
  assert.equal(complete.link.href, url);
});
