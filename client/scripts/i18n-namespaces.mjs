/**
 * Where the i18n scripts find each namespace's strings, per language.
 *
 *   translation  client/src/locales/<lang>/translation/*.json  (core; merged)
 *   <id>         client/src/integrations/<id>/locales/<lang>.json  (a module)
 *
 * A module's namespace is its id (see `ClientGameIntegration.locales`). Its
 * English is the reference its other languages are checked against, the same
 * way core's English is for core. The languages are core's: every language
 * core ships, a built-in module ships too.
 *
 * Run from `client/` like the scripts that import it.
 */

import fs from 'node:fs';
import path from 'node:path';

export const repoRoot = path.resolve(process.cwd(), '..');
export const localesDir = path.join(repoRoot, 'client', 'src', 'locales');
export const integrationsDir = path.join(repoRoot, 'client', 'src', 'integrations');

export const CORE_NAMESPACE = 'translation';

export function exists(p) {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function isPlainObject(v) {
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

/** Core's languages: every folder under `locales/` with a `translation/` in it, `en` included. */
export function languages() {
  if (!exists(localesDir)) return [];
  return fs
    .readdirSync(localesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && exists(path.join(localesDir, d.name, 'translation')))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

/** Ids of the modules that ship strings: `integrations/<id>/locales/en.json` exists. */
export function moduleNamespaces() {
  if (!exists(integrationsDir)) return [];
  return fs
    .readdirSync(integrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && exists(path.join(integrationsDir, d.name, 'locales', 'en.json')))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

/** `translation` first, then each module's. */
export function namespaces() {
  return [CORE_NAMESPACE, ...moduleNamespaces()];
}

/**
 * The JSON files that hold a namespace's strings for one language. Core's are
 * its topic files; a module's is one file, which may not exist yet.
 */
export function namespaceFiles(ns, lang) {
  if (ns === CORE_NAMESPACE) {
    const dir = path.join(localesDir, lang, 'translation');
    if (!exists(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort((a, b) => a.localeCompare(b))
      .map((f) => path.join(dir, f));
  }
  return [path.join(integrationsDir, ns, 'locales', `${lang}.json`)];
}

/** A namespace's strings in one language, merged; null when the language has none of it. */
export function loadNamespace(ns, lang) {
  const files = namespaceFiles(ns, lang).filter(exists);
  if (files.length === 0) return null;
  /** @type {Record<string, unknown>} */
  const merged = {};
  for (const f of files) deepMerge(merged, readJson(f));
  return merged;
}

/** Every locale JSON file the scripts look after: core's topic files and each module's. */
export function allLocaleFiles() {
  return namespaces().flatMap((ns) => languages().flatMap((lang) => namespaceFiles(ns, lang).filter(exists)));
}
