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
  assert.equal(missing.calls[0], '/releases.json');
  assert.equal(missing.version.textContent, 'v1.2.2');
  assert.equal(missing.link.href, 'https://example.test/old');
  const url = 'https://github.com/ajjs1ajjs/dist/releases/download/bck-v1.2.3/bck-linux-x86_64.tar.gz';
  const complete = await run({ 'bck-v': { version: 'v1.2.3', downloadUrl: url, name: 'bck-linux-x86_64.tar.gz' } });
  assert.equal(complete.version.textContent, 'v1.2.3');
  assert.equal(complete.link.href, url);
});
