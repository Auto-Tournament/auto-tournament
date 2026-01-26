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

function isProbablyOkToMatchEnglish(s) {
  // Keys that are often identical across languages or are proper nouns/tech terms.
  const exactOk = new Set([
    'ELO',
    'MatchZy',
    'CS2',
    'CS',
    // Proper nouns / providers
    'Steam',
    'GitHub',
    'Discord',
    'Keycloak',
    // App name / brand (usually not translated)
    'Matchzy Auto Tournament',
  ]);
  if (exactOk.has(s)) return true;
  // Pure placeholder values (used as labels elsewhere)
  if (/^\{\{[^}]+\}\}$/.test(s)) return true;
  if (/^[0-9\s.,:(){}[\]/_-]+$/.test(s)) return true;
  if (/^https?:\/\//i.test(s)) return true;
  if (/^[A-Z0-9]{2,}$/.test(s)) return true; // acronyms
  return false;
}

/**
 * Collect leaf string values by dot-path.
 * @param {unknown} obj
 */
function flattenStringLeaves(obj) {
  /** @type {Map<string, string>} */
  const out = new Map();

  /** @param {unknown} v @param {string[]} prefix */
  const walk = (v, prefix) => {
    if (isPlainObject(v)) {
      for (const [k, vv] of Object.entries(v)) walk(vv, prefix.concat(k));
      return;
    }
    if (Array.isArray(v)) return;
    if (typeof v === 'string' && prefix.length) out.set(prefix.join('.'), v);
  };
  walk(obj, []);
  return out;
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

const enStrings = flattenStringLeaves(en);
const locales = fs
  .readdirSync(localesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((name) => name !== 'en')
  .sort((a, b) => a.localeCompare(b));

const limit = Number(process.env.I18N_FALLBACK_LIMIT ?? '40');

let total = 0;

for (const locale of locales) {
  const merged = loadLocaleMergedJson(localesDir, locale);
  if (!merged) continue;
  const locStrings = flattenStringLeaves(merged);

  /** @type {{ path: string, value: string }[]} */
  const sameAsEn = [];

  for (const [p, v] of locStrings.entries()) {
    const enV = enStrings.get(p);
    if (typeof enV !== 'string') continue;
    if (v === enV && !isProbablyOkToMatchEnglish(v)) sameAsEn.push({ path: p, value: v });
  }

  if (sameAsEn.length === 0) continue;
  total += sameAsEn.length;
  // eslint-disable-next-line no-console
  console.log(`\n${locale}: ${sameAsEn.length} string(s) identical to en (excluding obvious OK matches)`);
  for (const item of sameAsEn.slice(0, limit)) {
    // eslint-disable-next-line no-console
    console.log(`  - ${item.path}: ${JSON.stringify(item.value)}`);
  }
  if (sameAsEn.length > limit) {
    // eslint-disable-next-line no-console
    console.log(`  ... (${sameAsEn.length - limit} more)`);
  }
}

// eslint-disable-next-line no-console
console.log(`\nTotal identical-to-en strings (filtered): ${total}`);

if (total > 0) process.exitCode = 2;

