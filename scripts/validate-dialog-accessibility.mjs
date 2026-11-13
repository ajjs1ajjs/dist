import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const translationsSource = await readFile(join(ROOT, 'translations.js'), 'utf8');
const i18nCtx = { window: {} };
vm.createContext(i18nCtx);
vm.runInContext(translationsSource, i18nCtx);
const I18N = i18nCtx.window.SITE_I18N || { uk: {}, en: {} };
const UK = I18N.uk || {};
const EN = I18N.en || {};

const pEntries = await readdir(join(ROOT, 'p'), { withFileTypes: true });
const productHtmlFiles = pEntries
  .filter((entry) => entry.isDirectory())
  .map((entry) => `p/${entry.name}/index.html`)
  .sort()
  .filter((rel) => existsSync(join(ROOT, rel)));

const htmlFiles = ['index.html', ...productHtmlFiles];
const errors = [];

function attr(tag, name) {
  const match = new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`, 'i').exec(tag);
  return match?.[1] ?? '';
}

function checkDialogContracts(relPath, html) {
  const openDialogs = [...html.matchAll(/<dialog\b[^>]*>|<[^>]+\brole=["']dialog["'][^>]*>/gi)].map(([tag]) => tag);
  const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/gi)].map(([, id]) => id));
  if (openDialogs.length === 0) {
    errors.push(`${relPath}: No <dialog> or role="dialog" elements found.`);
    return 0;
  }

  for (const [index, dialog] of openDialogs.entries()) {
    const id = attr(dialog, 'id') || `dialog #${index + 1}`;
    const isNativeDialog = /^<dialog\b/i.test(dialog);
    if (!isNativeDialog && attr(dialog, 'aria-modal') !== 'true') {
      errors.push(`${relPath}: ${id} must declare aria-modal="true".`);
    }

    const label = attr(dialog, 'aria-label').trim();
    const labelledBy = attr(dialog, 'aria-labelledby').trim().split(/\s+/).filter(Boolean);
    const i18nAttrs = attr(dialog, 'data-i18n-attr').split('|').filter(Boolean);
    if (!label && labelledBy.length === 0) {
      errors.push(`${relPath}: ${id} needs aria-label or aria-labelledby.`);
    } else if (!label && labelledBy.some((labelId) => !ids.has(labelId))) {
      errors.push(`${relPath}: ${id} aria-labelledby must reference existing element id(s).`);
    }

    const labelKey = i18nAttrs.map((spec) => spec.split(':')).find(([name]) => name === 'aria-label')?.[1]?.trim();
    if (labelKey && (UK[labelKey] === undefined || EN[labelKey] === undefined)) {
      errors.push(`${relPath}: ${id} translation key ${labelKey} must exist for both supported languages.`);
    }
  }
  return openDialogs.length;
}

function checkIndexI18nAndFilters(html) {
  for (const [chip] of html.matchAll(/<button\b[^>]*class=["'][^"']*\bchip\b[^"']*["'][^>]*>/gi)) {
    const filter = attr(chip, 'data-filter');
    const filterCount = attr(chip, 'data-filter-count');
    if (filter && filterCount !== filter) {
      errors.push(`index.html: chip[data-filter="${filter}"] must have matching data-filter-count="${filter}".`);
    }
  }

  for (const [, key] of html.matchAll(/\bdata-i18n=["']([^"']+)["']/g)) {
    if (UK[key] === undefined || EN[key] === undefined) {
      errors.push(`index.html: missing i18n key "${key}" in translations.js (${UK[key] === undefined ? 'uk' : 'en'}).`);
    }
  }
  for (const [, spec] of html.matchAll(/\bdata-i18n-attr=["']([^"']+)["']/g)) {
    for (const part of spec.split('|')) {
      const idx = part.indexOf(':');
      if (idx < 0) continue;
      const key = part.slice(idx + 1).trim();
      if (UK[key] === undefined || EN[key] === undefined) {
        errors.push(`index.html: missing i18n attr key "${key}" in translations.js (${UK[key] === undefined ? 'uk' : 'en'}).`);
      }
    }
  }
  for (const [, key] of html.matchAll(/\bdata-i18n-placeholder=["']([^"']+)["']/g)) {
    if (UK[key] === undefined || EN[key] === undefined) {
      errors.push(`index.html: missing i18n placeholder key "${key}" in translations.js (${UK[key] === undefined ? 'uk' : 'en'}).`);
    }
  }
}

function checkLocalAndDistAssets(relPath, html) {
  const fileDir = dirname(join(ROOT, relPath));
  const distPrefix = 'https://ajjs1ajjs.github.io/dist/';
  for (const match of html.matchAll(/(?:^|\s)(src|href|data-shot|content)=["']([^"']+)["']/gi)) {
    const attribute = match[1].toLowerCase();
    const rawValue = match[2];
    let target = null;

    if (rawValue.startsWith(distPrefix)) {
      const cleanRel = rawValue.slice(distPrefix.length).split('#')[0].split('?')[0];
      target = !cleanRel
        ? join(ROOT, 'index.html')
        : (cleanRel.endsWith('/') ? join(ROOT, cleanRel, 'index.html') : join(ROOT, cleanRel));
    } else if ((attribute === 'src' || attribute === 'href' || attribute === 'data-shot') && !/^(?:https?:|mailto:|data:|#)/i.test(rawValue)) {
      const cleanRel = rawValue.split('#')[0].split('?')[0];
      if (!cleanRel) continue;
      target = cleanRel.endsWith('/') ? resolve(fileDir, cleanRel, 'index.html') : resolve(fileDir, cleanRel);
    }

    if (target && !existsSync(target)) {
      errors.push(`${relPath}: missing asset or target "${rawValue}" (${target}).`);
    }
  }
}

let totalDialogs = 0;
for (const relPath of htmlFiles) {
  const html = await readFile(join(ROOT, relPath), 'utf8');
  totalDialogs += checkDialogContracts(relPath, html);
  if (relPath === 'index.html') checkIndexI18nAndFilters(html);
  checkLocalAndDistAssets(relPath, html);
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Dialog accessibility and hub integrity contract passed (${totalDialogs} dialogs across ${htmlFiles.length} pages).`);
}
