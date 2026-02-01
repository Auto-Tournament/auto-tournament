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

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonPretty(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (isPlainObject(v) && isPlainObject(target[k])) deepMerge(target[k], v);
    else target[k] = v;
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
  // Keep aligned with check-english-fallback-strings.mjs
  const exactOk = new Set([
    'ELO',
    'MatchZy',
    'CS2',
    'CS',
    'Steam',
    'GitHub',
    'Discord',
    'Keycloak',
    'Matchzy Auto Tournament',
  ]);
  if (exactOk.has(s)) return true;
  if (/^\{\{[^}]+\}\}$/.test(s)) return true;
  if (/^\[[A-Za-z0-9_]+\]$/.test(s)) return true;
  const stripped = s
    .replace(/\{\{[\s\S]*?\}\}/g, '')
    .replace(/\{[A-Z0-9_]+\}/g, '')
    .trim();
  if (stripped.length === 0) return true;
  if (/^[0-9\s.,:(){}[\]/_-•]+$/.test(stripped)) return true;
  if (/^de_[a-z0-9_]+$/.test(s)) return true;
  if (s === 'Dust II') return true;
  if (s === 'Astralis') return true;
  if (s === 's1mple') return true;
  if (s === 'ntlan') return true;
  if (s === 'server') return true;
  if (s === 'shared-rcon-password') return true;
  if (s === 'your-rcon-password') return true;
  if (/^[0-9\s.,:(){}[\]/_-]+$/.test(s)) return true;
  if (/^https?:\/\//i.test(s)) return true;
  if (/^[A-Z0-9]{2,}$/.test(s)) return true;
  return false;
}

function isBadTranslationOutput(s) {
  // Hard safety rails: reject markup/HTML or quota warning bodies.
  if (s.includes('MYMEMORY WARNING')) return true;
  if (s.includes('USED ALL AVAILABLE FREE TRANSLATIONS')) return true;
  // Markup injection / HTML pages
  if (/[<>]/.test(s)) return true;
  if (s.toLowerCase().includes('<!doctype')) return true;
  return false;
}

/**
 * @param {unknown} obj
 * @returns {Map<string, string>}
 */
function flattenStringLeaves(obj) {
  /** @type {Map<string, string>} */
  const out = new Map();
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

/**
 * @param {unknown} obj
 * @param {string[]} pathParts
 */
function setAtPath(obj, pathParts, newValue) {
  let cur = obj;
  for (let i = 0; i < pathParts.length - 1; i++) {
    const p = pathParts[i];
    if (!isPlainObject(cur[p])) cur[p] = {};
    cur = cur[p];
  }
  cur[pathParts[pathParts.length - 1]] = newValue;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url, { timeoutMs = 20000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Replace placeholders with stable tokens to protect them from translation.
 * Supports:
 * - i18next vars: {{...}}
 * - MatchZy tokens: {TIME}, {MATCH_ID}, etc
 * - Keep anything inside [] like [ADMIN], [MatchZy]
 * @param {string} s
 */
function maskPlaceholders(s) {
  /** @type {{ token: string, original: string }[]} */
  const mappings = [];
  let out = s;

  const pushToken = (original) => {
    const token = `__I18N_TOKEN_${mappings.length}__`;
    mappings.push({ token, original });
    return token;
  };

  // Mask {{...}} blocks first (including ICU-ish expressions)
  out = out.replace(/\{\{[\s\S]*?\}\}/g, (m) => pushToken(m));
  // Mask {TOKEN} style placeholders (e.g. {TIME})
  out = out.replace(/\{[A-Z0-9_]+\}/g, (m) => pushToken(m));
  // Mask bracketed prefixes like [ADMIN]
  out = out.replace(/\[[^\]]+\]/g, (m) => pushToken(m));

  return { text: out, mappings };
}

/**
 * @param {string} s
 * @param {{ token: string, original: string }[]} mappings
 */
function unmaskPlaceholders(s, mappings) {
  let out = s;
  for (const { token, original } of mappings) {
    out = out.split(token).join(original);
  }
  return out;
}

async function translateViaMyMemory(text, target) {
  const endpoint = process.env.MYMEMORY_URL ?? 'https://api.mymemory.translated.net/get';
  const url = `${endpoint}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`en|${target}`)}`;
  /** @type {unknown} */
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { timeoutMs: 20000 });
      if (!res.ok) throw new Error(`Translate failed (${res.status}): ${await res.text()}`);
      const data = await res.json();
      const t = data?.responseData?.translatedText;
      if (typeof t !== 'string') {
        throw new Error(`Translate returned unexpected payload: ${JSON.stringify(data).slice(0, 200)}`);
      }
      if (isBadTranslationOutput(t)) {
        throw new Error(`Translate returned unsafe output: ${t.slice(0, 120)}`);
      }
      return t;
    } catch (e) {
      lastErr = e;
      // Backoff (and avoid hammering if rate-limited)
      await sleep(250 * attempt * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const repoRoot = path.resolve(process.cwd(), '..');
const localesDir = path.join(repoRoot, 'client', 'src', 'locales');
const cacheDir = path.join(repoRoot, 'client', '.cache', 'i18n-translate');
ensureDir(cacheDir);

const localeToTarget = {
  de: 'de',
  es: 'es',
  fr: 'fr',
  it: 'it',
  nl: 'nl',
  pl: 'pl',
  'pt-PT': 'pt-PT',
  nb: 'no',
  'zh-CN': 'zh-CN',
};

const en = loadLocaleMergedJson(localesDir, 'en');
if (!en) {
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

const onlyLocales = (process.env.I18N_TRANSLATE_LOCALES ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const onlyFiles = (process.env.I18N_TRANSLATE_FILES ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`Locales: ${locales.join(', ')}`);

for (const locale of locales) {
  if (onlyLocales.length && !onlyLocales.includes(locale)) continue;
  const target = localeToTarget[locale];
  if (!target) {
    console.warn(`Skipping ${locale}: no target language mapping`);
    continue;
  }

  const localeDir = path.join(localesDir, locale, 'translation');
  const jsonFiles = fs
    .readdirSync(localeDir)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => (onlyFiles.length ? onlyFiles.includes(f) : true))
    .sort((a, b) => a.localeCompare(b));

  const cachePath = path.join(cacheDir, `${locale}.json`);
  /** @type {Record<string, string>} */
  const cache = exists(cachePath) ? readJson(cachePath) : {};
  let cacheDirty = false;

  console.log(`\n== ${locale} (${target}) ==`);

  for (const fileName of jsonFiles) {
    console.log(`-- ${fileName}`);
    const filePath = path.join(localeDir, fileName);
    const obj = readJson(filePath);
    const leaves = flattenStringLeaves(obj);
    let changed = 0;

    for (const [p, v] of leaves.entries()) {
      const enV = enStrings.get(p);
      if (typeof enV !== 'string') continue;
      if (v !== enV) continue;
      if (isProbablyOkToMatchEnglish(v)) continue;

      const cacheKey = `${target}::${enV}`;
      let translated = cache[cacheKey];
      if (!translated) {
        const { text, mappings } = maskPlaceholders(enV);
        try {
          const t = await translateViaMyMemory(text, target);
          translated = unmaskPlaceholders(t, mappings);
          cache[cacheKey] = translated;
          cacheDirty = true;
          // gentle pacing
          await sleep(250);
        } catch (e) {
          console.warn(`Translate failed for ${locale} ${p}: ${(e && e.message) || e}`);
          continue;
        }
      }

      if (translated && translated !== v) {
        setAtPath(obj, p.split('.'), translated);
        changed++;
      }
    }

    if (changed > 0) {
      writeJsonPretty(filePath, obj);
      console.log(`- ${fileName}: translated ${changed} string(s)`);
      changed = 0;
    }
  }

  if (cacheDirty) writeJsonPretty(cachePath, cache);
}

