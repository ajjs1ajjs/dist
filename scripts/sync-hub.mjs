// Синхронізація версій хаба dist (index.html) з живими релізами.
// Використання: node scripts/sync-hub.mjs [--check] [--check-catalog]
//   --check: dry-run, exit 2 якщо є зміни; --check-catalog: звірка
//   apps/catalog.json з хабом, SITE-скриптом і retention (exit 1 при дрейфі).
// Ті самі newest-tag правила що в SITE scripts/sync-versions.mjs.
// Запускається з .github/workflows/sync-site.yml (job sync-hub) на кожен
// реліз + cron: версії на обох вітринах оновлюються автоматично.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = join(ROOT, 'index.html');
const CATALOG = join(ROOT, 'apps', 'catalog.json');
const SITE_INDEX = join(process.env.SITE_DIR || join(ROOT, '..', 'SITE'), 'public', 'index.html');
const REPO = process.env.DIST_REPO || 'ajjs1ajjs/dist';

// Патерни асета для A-посилань — 1:1 з LATEST_ASSET_PATTERNS в index.html.
const CONFIG = {
  'kubelens-v': { pattern: /setup\.exe$/i },
  'rdm-v': { pattern: /setup\.exe$/i },
  'netscope-v': { pattern: /portable\.zip$/i },
  'calculator-v': { pattern: /\.exe$/i },
  'rescalc-v': { pattern: /setup.*\.exe$/i },
  'diskcleaner-v': { pattern: /\.exe$/i },
};

async function fetchReleases() {
  const headers = { 'User-Agent': 'dist-hub-sync', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return (await res.json()).filter(r => !r.draft && !r.prerelease);
}

function verParts(tag, prefix) {
  return tag.slice(prefix.length).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
}

function cmpVer(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--check-catalog')) return checkCatalog();

  const checkOnly = args.includes('--check');
  const releases = await fetchReleases().catch(err => {
    console.error('FAIL:', err.message);
    process.exit(1);
  });
  const latest = {};
  for (const rel of releases) {
    if (!rel.tag_name) continue;
    for (const prefix of Object.keys(CONFIG)) {
      if (!rel.tag_name.startsWith(prefix)) continue;
      const cur = latest[prefix];
      if (!cur || cmpVer(verParts(rel.tag_name, prefix), verParts(cur.tag_name, prefix)) > 0) {
        latest[prefix] = rel;
      }
    }
  }

  let html = readFileSync(INDEX, 'utf8');
  const changes = [];
  for (const [prefix, rel] of Object.entries(latest)) {
    const ver = 'v' + rel.tag_name.slice(prefix.length).replace(/^v/i, '');
    const verRe = new RegExp(`(data-latest="${escRe(prefix)}">)[^<]*<`, 'g');
    const before = html;
    html = html.replace(verRe, `$1${ver}<`);
    if (html !== before) changes.push(`${prefix} ver -> ${ver}`);
    const asset = rel.assets?.find(a => CONFIG[prefix].pattern.test(a.name));
    if (asset?.browser_download_url) {
      const url = asset.browser_download_url;
      const hrefRe1 = new RegExp(`(data-latest="${escRe(prefix)}"[^>]*?href=")[^"]*(")`, 'g');
      const hrefRe2 = new RegExp(`(href=")[^"]*("[^>]*?data-latest="${escRe(prefix)}")`, 'g');
      const h0 = html;
      html = html.replace(hrefRe1, `$1${url}$2`).replace(hrefRe2, `$1${url}$2`);
      if (html !== h0) changes.push(`${prefix} href -> ${asset.name}`);
    }
  }
  if (!changes.length) {
    console.log('Хаб уже свіжий — змін нема.');
    return;
  }
  console.log('Знайдені оновлення:');
  for (const c of changes) console.log('  • ' + c);
  if (checkOnly) {
    console.log('(dry-run --check: файл не змінено)');
    process.exitCode = 2;
    return;
  }
  writeFileSync(INDEX, html);
  console.log(`\nOK: index.html оновлено (${changes.length} замін).`);
}

function checkCatalog() {
  // Єдиний реєстр продуктів + 4 місця, що мусять збігатися.
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')).products.map(p => p.prefix).sort();
  const problems = [];
  const hubHtml = readFileSync(INDEX, 'utf8');
  const hub = [...new Set([...hubHtml.matchAll(/data-latest="([a-z]+-v)"/g)].map(m => m[1]))].sort();
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

main();
