/**
 * Key parity against English, for core (`translation`) and for each module's
 * namespace (`integrations/<id>/locales`), in every language core ships.
 * "0 missing, 0 extra" means every namespace in every language has exactly
 * the keys its own English has (plus plural forms English does not use).
 */

import { isPlainObject, languages, loadNamespace, namespaces } from './i18n-namespaces.mjs';

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

const langs = languages();
if (!langs.includes('en')) {
  console.error('ERROR: English locale not found at src/locales/en/translation');
  process.exit(1);
}

/** @type {{ ns: string, locale: string, missing: string[], extra: string[] }[]} */
const results = [];

for (const ns of namespaces()) {
  const en = loadNamespace(ns, 'en');
  if (!en) {
    console.error(`ERROR: no English strings for namespace ${ns}`);
    process.exit(1);
  }
  const enPaths = flattenLeafPaths(en);
  // Plural categories English doesn't have (e.g. Polish _few/_many) are required
  // for those locales, so they are not "extra" as long as en has the _other form.
  const isLocalePluralForm = (p) => {
    const m = p.match(/^(.*)_(zero|two|few|many)$/);
    return !!m && enPaths.has(`${m[1]}_other`);
  };

  for (const locale of langs) {
    if (locale === 'en') continue;
    // A language with no file for a module's namespace is missing all of it.
    const locPaths = flattenLeafPaths(loadNamespace(ns, locale) ?? {});
    const missing = [...enPaths].filter((p) => !locPaths.has(p)).sort((a, b) => a.localeCompare(b));
    const extra = [...locPaths]
      .filter((p) => !enPaths.has(p) && !isLocalePluralForm(p))
      .sort((a, b) => a.localeCompare(b));
    results.push({ ns, locale, missing, extra });
  }
}

const totalMissing = results.reduce((sum, r) => sum + r.missing.length, 0);
const totalExtra = results.reduce((sum, r) => sum + r.extra.length, 0);

console.log(
  `i18n missing keys vs en: ${totalMissing} missing, ${totalExtra} extra (leaf paths; namespaces: ${namespaces().join(', ')}).`
);

const limit = Number(process.env.I18N_MISSING_LIMIT ?? '50');
for (const r of results) {
  if (r.missing.length === 0 && r.extra.length === 0) continue;
  console.log(`\n${r.locale} [${r.ns}]: missing ${r.missing.length}, extra ${r.extra.length}`);
  if (r.missing.length) {
    console.log('  missing (first):');
    for (const p of r.missing.slice(0, limit)) console.log(`    - ${p}`);
    if (r.missing.length > limit) console.log(`    ... (${r.missing.length - limit} more)`);
  }
  if (r.extra.length) {
    console.log('  extra (first):');
    for (const p of r.extra.slice(0, limit)) console.log(`    - ${p}`);
    if (r.extra.length > limit) console.log(`    ... (${r.extra.length - limit} more)`);
  }
}

if (totalMissing > 0) process.exitCode = 2;
