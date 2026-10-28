import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const salesDir = resolve('sales');
const worker = await readFile(resolve(salesDir, 'sw.js'), 'utf8');
const precache = [...worker.matchAll(/"url":"([^"\\]+)"/g)].map((match) => match[1]);

if (precache.length === 0) throw new Error('Sales service worker has no precache resources.');

for (const url of precache) {
  if (url.startsWith('/') || url.split('/').includes('..')) {
    throw new Error(`Unsafe Sales precache URL: ${url}`);
  }
  const target = resolve(salesDir, url);
  if (!target.startsWith(`${salesDir}${sep}`)) throw new Error(`Sales precache escapes its site directory: ${url}`);
  try {
    if (!(await stat(target)).isFile()) throw new Error('not a file');
  } catch {
    throw new Error(`Sales precache resource is missing: ${url}`);
  }
}

console.log(`Validated ${precache.length} Sales precache resources.`);
