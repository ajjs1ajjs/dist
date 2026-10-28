import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const translations = await readFile(new URL('../translations.js', import.meta.url), 'utf8');
const openDialogs = [...html.matchAll(/<[^>]+\brole=["']dialog["'][^>]*>/gi)].map(([tag]) => tag);
const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/gi)].map(([, id]) => id));
const errors = [];

function attr(tag, name) {
  const match = new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(tag);
  return match?.[1] ?? '';
}

if (openDialogs.length === 0) errors.push('No role="dialog" elements found.');

for (const [index, dialog] of openDialogs.entries()) {
  const id = attr(dialog, 'id') || `dialog #${index + 1}`;
  if (attr(dialog, 'aria-modal') !== 'true') errors.push(`${id} must declare aria-modal="true".`);

  const label = attr(dialog, 'aria-label').trim();
  const labelledBy = attr(dialog, 'aria-labelledby').trim().split(/\s+/).filter(Boolean);
  const i18nAttrs = attr(dialog, 'data-i18n-attr').split('|');
  if (!label && labelledBy.length === 0) {
    errors.push(`${id} needs aria-label or aria-labelledby.`);
  } else if (!label && labelledBy.some((labelId) => !ids.has(labelId))) {
    errors.push(`${id} aria-labelledby must reference existing element id(s).`);
  }

  const labelKey = i18nAttrs.map((spec) => spec.split(':')).find(([name]) => name === 'aria-label')?.[1];
  if (labelKey) {
    const occurrences = [...translations.matchAll(new RegExp(`['\"]${labelKey}['\"]\\s*:`, 'g'))].length;
    if (occurrences < 2) errors.push(`${id} translation key ${labelKey} must exist for both supported languages.`);
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Dialog accessibility contract passed (${openDialogs.length} dialogs).`);
}
