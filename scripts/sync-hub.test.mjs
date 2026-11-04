import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchReleases, selectLatest, validateAsset } from './sync-hub.mjs';

const response = (data, status = 200) => ({ ok: status === 200, status, json: async () => data });
test('loads every release page and rejects incomplete listings', async () => {
  const seen = [];
  const data = await fetchReleases(async url => {
    seen.push(url);
    return response(seen.length === 1 ? Array.from({ length: 100 }, (_, i) => ({ tag_name: `other-v1.0.${i}` })) : [{ tag_name: 'bck-v1.0.0' }]);
  });
  assert.equal(data.length, 101);
  assert.match(seen[1], /page=2/);
  assert.equal(selectLatest(data)['bck-v'].tag_name, 'bck-v1.0.0');
  await assert.rejects(fetchReleases(async url => url.endsWith('page=1') ? response(Array(100).fill({})) : response([], 503)), /503/);
});
test('selects only stable semver and compares numeric components', () => {
  const result = selectLatest(['bck-v1.2.9', 'bck-v1.10.0', 'bck-v99.0.0-rc.1', 'bck-v2.0.0junk'].map(tag_name => ({ tag_name })));
  assert.equal(result['bck-v'].tag_name, 'bck-v1.10.0');
});

test('incomplete releases fail before the HTML can be written', () => {
  assert.throws(() => validateAsset('bck-v', { tag_name: 'bck-v1.2.3' }, null), /Missing required asset/);
  assert.doesNotThrow(() => validateAsset('bck-v', { tag_name: 'bck-v1.2.3' }, { browser_download_url: 'https://github.com/ajjs1ajjs/dist/releases/download/bck-v1.2.3/bck.tar.gz' }));
  assert.throws(() => validateAsset('bck-v', { tag_name: 'bck-v1.2.3' }, { browser_download_url: 'https://evil.example/file' }), /Missing required asset/);
  assert.doesNotThrow(() => validateAsset('sales-v', { tag_name: 'sales-v1.2.3' }, null));
});
