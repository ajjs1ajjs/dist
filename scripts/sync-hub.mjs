// Синхронізація версій хаба dist (index.html) з живими релізами.
// Використання: node scripts/sync-hub.mjs [--check] [--check-catalog]
//   --check: dry-run, exit 2 якщо є зміни; --check-catalog: звірка
//   apps/catalog.json з хабом, SITE-скриптом і retention (exit 1 при дрейфі).
// Ті самі newest-tag правила що в SITE scripts/sync-versions.mjs.
// Запускається з .github/workflows/sync-site.yml (job sync-hub) на кожен
// реліз + cron: версії на обох вітринах оновлюються автоматично.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = join(ROOT, 'index.html');
const MANIFEST = join(ROOT, 'releases.json');
const CATALOG = join(ROOT, 'apps', 'catalog.json');
const SITE_INDEX = join(process.env.SITE_DIR || join(ROOT, '..', 'SITE'), 'public', 'index.html');
const REPO = process.env.DIST_REPO || 'ajjs1ajjs/dist';

// Патерни асета для A-посилань — 1:1 з SITE release-catalog.json.
const products = JSON.parse(readFileSync(CATALOG, 'utf8')).products;
const CONFIG = Object.fromEntries(products.map(({ prefix, assetPattern, slug }) => [prefix, { pattern: assetPattern ? new RegExp(assetPattern, 'i') : null, slug }]));

export async function fetchReleases(fetchImpl = fetch) {
  const headers = { 'User-Agent': 'dist-hub-sync', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const releases = [];
  for (let page = 1; page <= 50; page++) {
    const res = await fetchImpl(`https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status} on page ${page}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error(`Invalid releases page ${page}`);
    releases.push(...data.filter(r => !r.draft && !r.prerelease));
    if (data.length < 100) return releases;
  }
  throw new Error('Release listing exceeded 50 pages; refusing incomplete selection');
}

function verParts(tag, prefix) {
  const version = tag.slice(prefix.length);
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ? version.split('.').map(Number) : null;
}

function cmpVer(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

export function selectLatest(releases) {
  const latest = {};
  for (const rel of releases) {
    if (!rel.tag_name) continue;
    for (const prefix of Object.keys(CONFIG)) {
      if (!rel.tag_name.startsWith(prefix)) continue;
      const version = verParts(rel.tag_name, prefix);
      if (!version) continue;
      const cur = latest[prefix];
      if (!cur || cmpVer(version, verParts(cur.tag_name, prefix)) > 0) {
        latest[prefix] = rel;
      }
    }
  }
  return latest;
}

export function validateAsset(prefix, rel, asset) {
  let safeUrl = false;
  try {
    const url = new URL(asset?.browser_download_url);
    safeUrl = url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith(`/${REPO}/releases/download/${rel.tag_name}/`);
  } catch {}
  if (CONFIG[prefix]?.pattern && !safeUrl) {
    throw new Error(`Missing required asset for ${rel.tag_name}`);
  }
}

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const canonicalJson = (value) => JSON.stringify(value, (_key, item) => (
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item
));

function targetFiles() {
  const list = [INDEX];
  for (const { slug } of products) {
    if (!slug) continue;
    const pagePath = join(ROOT, 'p', slug, 'index.html');
    if (existsSync(pagePath)) list.push(pagePath);
  }
  return list;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--check-catalog')) return checkCatalog();

  const checkOnly = args.includes('--check');
  const releases = await fetchReleases().catch(err => {
    console.error('FAIL:', err.message);
    process.exit(1);
  });
  const latest = selectLatest(releases);

  const selectedAssets = {};
  for (const [prefix, rel] of Object.entries(latest)) {
    const pattern = CONFIG[prefix].pattern;
    const asset = pattern ? rel.assets?.find(a => pattern.test(a.name)) : null;
    validateAsset(prefix, rel, asset);
    selectedAssets[prefix] = asset;
  }

  const changes = [];
  const pendingWrites = [];
  for (const file of targetFiles()) {
    let html = readFileSync(file, 'utf8');
    const original = html;
    const label = file === INDEX ? 'index.html' : file.slice(ROOT.length + 1);
    for (const [prefix, rel] of Object.entries(latest)) {
      const cfg = CONFIG[prefix];
      const asset = selectedAssets[prefix];
      const rawVer = rel.tag_name.slice(prefix.length).replace(/^v/i, '');
      const ver = 'v' + rawVer;
      const verRe = new RegExp(`(data-latest-ver="${escRe(prefix)}">)[^<]*<`, 'g');
      const before = html;
      html = html.replace(verRe, `$1${ver}<`);
      if (html !== before) changes.push(`${label}: ${prefix} ver -> ${ver}`);
      if (asset?.browser_download_url) {
        const url = asset.browser_download_url;
        const hrefRe1 = new RegExp(`(data-latest-href="${escRe(prefix)}"[^>]*?href=")[^"]*(")`, 'g');
        const hrefRe2 = new RegExp(`(href=")[^"]*("[^>]*?data-latest-href="${escRe(prefix)}")`, 'g');
        const h0 = html;
        html = html.replace(hrefRe1, `$1${url}$2`).replace(hrefRe2, `$1${url}$2`);
        if (html !== h0) changes.push(`${label}: ${prefix} href -> ${asset.name}`);

        const codeRe = new RegExp(`(data-latest-code="${escRe(prefix)}">)[^<]*<`, 'g');
        const c0 = html;
        html = html.replace(codeRe, `$1${asset.name}<`);
        if (html !== c0) changes.push(`${label}: ${prefix} file -> ${asset.name}`);
      }
      if (cfg.slug && (file.includes(`/p/${cfg.slug}/`) || file.includes(`\\p\\${cfg.slug}\\`))) {
        const svRe = /("softwareVersion":\s*")[^"]*(")/;
        const s0 = html;
        html = html.replace(svRe, `$1${rawVer}$2`);
        if (html !== s0) changes.push(`${label}: ${prefix} softwareVersion -> ${rawVer}`);
      }
    }
    if (html !== original) pendingWrites.push({ file, contents: html });
  }

  const latestManifest = {};
  for (const [prefix, rel] of Object.entries(latest)) {
    const asset = selectedAssets[prefix];
    const version = 'v' + rel.tag_name.slice(prefix.length).replace(/^v/i, '');
    latestManifest[prefix] = {
      version,
      ...(asset?.name ? { name: String(asset.name).replace(/[<>]/g, '') } : {}),
      ...(asset?.browser_download_url ? { downloadUrl: asset.browser_download_url } : {}),
    };
  }
  let currentManifest = null;
  try { currentManifest = JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch {}
  const manifestMatches = currentManifest?.schemaVersion === 1
    && canonicalJson(currentManifest.latest) === canonicalJson(latestManifest);
  if (!manifestMatches) {
    changes.push('releases.json: manifest updated');
    pendingWrites.push({
      file: MANIFEST,
      contents: JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), latest: latestManifest }, null, 2) + '\n',
    });
  }

  if (!changes.length) {
    console.log('Хаб уже свіжий — змін нема.');
    return;
  }
  console.log('Знайдені оновлення:');
  for (const c of changes) console.log('  • ' + c);
  if (checkOnly) {
    console.log('(dry-run --check: файли не змінено)');
    process.exitCode = 2;
    return;
  }
  for (const { file, contents } of pendingWrites) writeFileSync(file, contents, 'utf8');
  console.log(`\nOK: оновлено ${pendingWrites.length} файл(ів), ${changes.length} замін.`);
}

function checkCatalog() {
  // Єдиний реєстр продуктів + 4 місця, що мусять збігатися.
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')).products.map(p => p.prefix).sort();
  const problems = [];
  const hubHtml = readFileSync(INDEX, 'utf8');
  const hub = [...new Set([...hubHtml.matchAll(/data-latest-ver="([a-z]+-v)"/g)].map(m => m[1]))].sort();
  const checks = [['hub', hub]];
  try {
    const siteHtml = readFileSync(SITE_INDEX, 'utf8');
    checks.push(['site', [...new Set([...siteHtml.matchAll(/data-latest-ver="([a-z]+-v)"/g)].map(m => m[1]))].sort()]);
  } catch {
    console.log('(SITE недоступний тут — звірка тільки hub/retention; повна — локально з SITE_DIR)');
  }
  const retention = readFileSync(join(ROOT, '.github', 'workflows', 'release-retention.yml'), 'utf8');
  const retentionList = /PREFIXES:\s*'([^']+)'/.exec(retention)?.[1].split(/\s+/).map(p => `${p}-v`).sort() ?? [];
  const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  // retention може містити зайві (game) — перевіряємо лише покриття каталогу.
  for (const [name, list] of checks) {
    const missing = catalog.filter(p => !list.includes(p));
    const extra = list.filter(p => !catalog.includes(p));
    if (missing.length || extra.length) problems.push(`${name}: missing [${missing}] extra [${extra}]`);
  }
  const uncovered = catalog.filter(p => !retentionList.includes(p));
  if (uncovered.length) problems.push(`retention: uncovered [${uncovered}]`);
  if (problems.length) {
    console.error('CATALOG DRIFT:');
    for (const p of problems) console.error('  • ' + p);
    process.exit(1);
  }
  console.log(`Каталог в синхроні: ${catalog.length} продуктів (${checks.map(c => c[0]).join('/')}/retention).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => { console.error('FAIL:', err.message); process.exitCode = 1; });
}
