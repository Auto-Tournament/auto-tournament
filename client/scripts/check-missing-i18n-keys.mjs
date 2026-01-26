import fs from 'node:fs';
import path from 'node:path';

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (isPlainObject(v) && isPlainObject(target[k])) {
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

function flattenLeafPaths(obj) {
  /** @type {Set<string>} */
  const out = new Set();

  /** @param {unknown} v @param {string[]} prefix */
  const walk = (v, prefix) => {
    if (isPlainObject(v)) {
      const entries = Object.entries(v);
      if (entries.length === 0 && prefix.length) {
        // empty object counts as leaf container; still useful to track
        out.add(prefix.join('.'));
        return;
      }
      for (const [k, vv] of entries) walk(vv, prefix.concat(k));
      return;
    }

    if (Array.isArray(v)) {
      // treat arrays as leaf values; i18n should generally avoid arrays
      if (prefix.length) out.add(prefix.join('.'));
      return;
    }

    if (prefix.length) out.add(prefix.join('.'));
  };

  walk(obj, []);
  return out;
}

function loadLocaleMergedJson(localesDir, localeName) {
  const dir = path.join(localesDir, localeName, 'translation');
  if (!exists(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b));

  /** @type {Record<string, unknown>} */
  const merged = {};
  for (const f of files) deepMerge(merged, readJson(path.join(dir, f)));
  return merged;
}

const repoRoot = path.resolve(process.cwd(), '..');
const localesDir = path.join(repoRoot, 'client', 'src', 'locales');

if (!exists(localesDir)) {
  // eslint-disable-next-line no-console
  console.error('ERROR: locales dir not found:', localesDir);
  process.exit(1);
}

const en = loadLocaleMergedJson(localesDir, 'en');
if (!en) {
  // eslint-disable-next-line no-console
  console.error('ERROR: English locale not found at src/locales/en/translation');
  process.exit(1);
}

const enPaths = flattenLeafPaths(en);
const locales = fs
  .readdirSync(localesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((name) => name !== 'en')
  .sort((a, b) => a.localeCompare(b));

/** @type {{ locale: string, missing: string[], extra: string[] }[]} */
const results = [];

for (const locale of locales) {
  const merged = loadLocaleMergedJson(localesDir, locale);
  if (!merged) continue;

  const locPaths = flattenLeafPaths(merged);
  const missing = [...enPaths].filter((p) => !locPaths.has(p)).sort((a, b) => a.localeCompare(b));
  const extra = [...locPaths].filter((p) => !enPaths.has(p)).sort((a, b) => a.localeCompare(b));
  results.push({ locale, missing, extra });
}

const totalMissing = results.reduce((sum, r) => sum + r.missing.length, 0);
const totalExtra = results.reduce((sum, r) => sum + r.extra.length, 0);

// eslint-disable-next-line no-console
console.log(`i18n missing keys vs en: ${totalMissing} missing, ${totalExtra} extra (leaf paths).`);

const limit = Number(process.env.I18N_MISSING_LIMIT ?? '50');
for (const r of results) {
  if (r.missing.length === 0 && r.extra.length === 0) continue;
  // eslint-disable-next-line no-console
  console.log(`\n${r.locale}: missing ${r.missing.length}, extra ${r.extra.length}`);
  if (r.missing.length) {
    // eslint-disable-next-line no-console
    console.log('  missing (first):');
    for (const p of r.missing.slice(0, limit)) console.log(`    - ${p}`);
    if (r.missing.length > limit) console.log(`    ... (${r.missing.length - limit} more)`);
  }
  if (r.extra.length) {
    // eslint-disable-next-line no-console
    console.log('  extra (first):');
    for (const p of r.extra.slice(0, limit)) console.log(`    - ${p}`);
    if (r.extra.length > limit) console.log(`    ... (${r.extra.length - limit} more)`);
  }
}

if (totalMissing > 0) process.exitCode = 2;
