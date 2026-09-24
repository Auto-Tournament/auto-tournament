#!/usr/bin/env node
/**
 * Move each built-in module's strings out of core's locale files and into the
 * module's own namespace (DESIGN-modules.md §4.3, item 6).
 *
 *   client/src/locales/<lang>/translation/*.json      core, namespace `translation`
 *   client/src/integrations/<id>/locales/<lang>.json  module, namespace `<id>`
 *
 * Who owns a key is read from the code, not from a list:
 *
 * - Every string literal in `client/src` is collected, per file, with a
 *   tokenizer that skips comments. A literal equal to a key (or to the base of
 *   a plural key, `foo` for `foo_one`) references it. A literal ending in `.`,
 *   or the static head of a template literal just before a `${`, references
 *   every key under that prefix (`t(\`serversPage.pluginStatus.${s}\`)`).
 * - A file under `client/src/integrations/<id>/` is module `<id>`'s; every
 *   other file is core's.
 * - A key only one module references moves to that module. A key core
 *   references, or two modules do, stays in core ("shared").
 * - A key nothing references inherits from the nearest parent that has
 *   referenced keys under it: it moves when all of those are one module's,
 *   stays when they are all core's, and otherwise stays in core and is listed
 *   as unsure. A top-level group nothing references at all stays in core.
 * - A module's nav item labels move with it: for each `key` in its `navItems`,
 *   `nav.<key>`, `layout.pageTitle.<key>`, `managePage.rail.<key>` and
 *   `dashboard.site.<key>.*`. Core renders them from the module's namespace
 *   (see `IntegrationNavItem` in `client/src/integrations/types.ts`).
 *
 * Every language moves the same keys English does, with its own values, so a
 * translation is never replaced by English. Plural forms English does not
 * have (Polish `_few`/`_many`) move with their `_other`.
 *
 * Idempotent: once the move is done the core files hold no module-only key,
 * and a second run finds nothing to move.
 *
 * usage:
 *   node scripts/move-module-strings.mjs          # report only
 *   node scripts/move-module-strings.mjs --write  # move, then report
 *   node scripts/move-module-strings.mjs --list   # also list every moved key
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'client', 'src');
const LOCALES = path.join(SRC, 'locales');
const INTEGRATIONS = path.join(SRC, 'integrations');

const WRITE = process.argv.includes('--write');
const LIST = process.argv.includes('--list');

const PLURAL = /^(.*)_(zero|one|two|few|many|other)$/;

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, obj) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
};

// ---------------------------------------------------------------------------
// Locale files
// ---------------------------------------------------------------------------

const languages = fs
  .readdirSync(LOCALES, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(LOCALES, d.name, 'translation')))
  .map((d) => d.name)
  .sort();

/** Topic files a language merges into `translation` (its `index.ts` imports). */
function topicFiles(lang) {
  const dir = path.join(LOCALES, lang, 'translation');
  const index = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  return [...index.matchAll(/from '\.\/([\w-]+\.json)'/g)].map((m) => path.join(dir, m[1]));
}

/** Leaf paths in document order. */
function leaves(obj, prefix = [], out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix.concat(k);
    if (isObject(v) && Object.keys(v).length > 0) leaves(v, p, out);
    else out.push(p.join('.'));
  }
  return out;
}

function getPath(obj, dotted) {
  let cur = obj;
  for (const part of dotted.split('.')) {
    if (!isObject(cur) || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    if (!isObject(cur[part])) cur[part] = {};
    cur = cur[part];
  }
  cur[parts.at(-1)] = value;
}

/** Remove a leaf, then any parent it leaves empty. */
function deletePath(obj, dotted) {
  const parts = dotted.split('.');
  const chain = [obj];
  for (const part of parts.slice(0, -1)) {
    const next = chain.at(-1)[part];
    if (!isObject(next)) return;
    chain.push(next);
  }
  delete chain.at(-1)[parts.at(-1)];
  for (let i = chain.length - 1; i > 0; i--) {
    if (Object.keys(chain[i]).length > 0) break;
    delete chain[i - 1][parts[i - 1]];
  }
}

// ---------------------------------------------------------------------------
// References in the code
// ---------------------------------------------------------------------------

function sourceFiles(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'locales' || ent.name === 'node_modules') continue;
      sourceFiles(p, out);
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(ent.name) && !ent.name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

/**
 * String literals in a TS/TSX file, comments skipped. Template literals give
 * one entry per static part, marked `dynamic` when a `${` follows it.
 * Good enough for this codebase: no regex literal in `client/src` contains a
 * quote that would throw it off (a miss only ever keeps a key in core).
 */
function literals(src) {
  /** @type {{ value: string, dynamic: boolean }[]} */
  const out = [];
  let i = 0;
  /** @type {number[]} brace depth per open `${` */
  const templateStack = [];
  let depth = 0;

  const readTemplate = () => {
    // src[i] is just after a backtick or a closing `}` of `${`
    let buf = '';
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\') {
        buf += src[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === '`') {
        out.push({ value: buf, dynamic: false });
        i++;
        return;
      }
      if (ch === '$' && src[i + 1] === '{') {
        out.push({ value: buf, dynamic: true });
        i += 2;
        templateStack.push(depth);
        depth++;
        return;
      }
      buf += ch;
      i++;
    }
  };

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let buf = '';
      i++;
      while (i < src.length && src[i] !== ch && src[i] !== '\n') {
        if (src[i] === '\\') {
          buf += src[i + 1] ?? '';
          i += 2;
          continue;
        }
        buf += src[i];
        i++;
      }
      i++;
      out.push({ value: buf, dynamic: false });
      continue;
    }
    if (ch === '`') {
      i++;
      readTemplate();
      continue;
    }
    if (ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      depth--;
      i++;
      if (templateStack.length && depth === templateStack.at(-1)) {
        templateStack.pop();
        readTemplate();
      }
      continue;
    }
    i++;
  }
  return out;
}

/** `cs2`, `manual-report` or `core`, by where the file lives. */
function ownerOf(file) {
  const rel = path.relative(INTEGRATIONS, file);
  if (rel.startsWith('..')) return 'core';
  const [first, ...rest] = rel.split(path.sep);
  return rest.length > 0 ? first : 'core';
}

const modules = fs
  .readdirSync(INTEGRATIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

/** `navItems: [{ key: 'servers', … }]` in a module's index. */
function navItemKeys(id) {
  const index = ['index.tsx', 'index.ts']
    .map((f) => path.join(INTEGRATIONS, id, f))
    .find((f) => fs.existsSync(f));
  if (!index) return [];
  const src = fs.readFileSync(index, 'utf8');
  const block = src.match(/navItems:\s*\[([\s\S]*?)\]/);
  if (!block) return [];
  return [...block[1].matchAll(/key:\s*'([\w-]+)'/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/** English, merged, and which topic file each English leaf lives in. */
const enMerged = {};
for (const file of topicFiles('en')) Object.assign(enMerged, readJson(file));
const enLeaves = leaves(enMerged);
const enLeafSet = new Set(enLeaves);

/** plural base -> its English forms (`foo` -> `foo_one`, `foo_other`) */
const pluralForms = new Map();
for (const leaf of enLeaves) {
  const m = leaf.match(PLURAL);
  if (!m) continue;
  if (!pluralForms.has(m[1])) pluralForms.set(m[1], []);
  pluralForms.get(m[1]).push(leaf);
}

/** leaf -> owners that reference it */
const refs = new Map(enLeaves.map((leaf) => [leaf, new Set()]));
/** static references found in code, for the nav-label sanity check */
const staticRefsByOwner = new Map();

const prefixIndex = new Map(); // prefix -> owners
for (const file of sourceFiles(SRC)) {
  const owner = ownerOf(file);
  const src = fs.readFileSync(file, 'utf8');
  for (const { value, dynamic } of literals(src)) {
    if (!value || /\s/.test(value)) continue;
    if (dynamic || value.endsWith('.')) {
      if (!value.includes('.')) continue;
      const prefix = value.endsWith('.') ? value : null;
      if (!prefix) continue;
      if (!prefixIndex.has(prefix)) prefixIndex.set(prefix, new Set());
      prefixIndex.get(prefix).add(owner);
      continue;
    }
    // A key itself, or the base of a plural group (every form English has).
    for (const candidate of [value, ...(pluralForms.get(value) ?? [])]) {
      if (!refs.has(candidate)) continue;
      refs.get(candidate).add(owner);
      if (!staticRefsByOwner.has(candidate)) staticRefsByOwner.set(candidate, new Set());
      staticRefsByOwner.get(candidate).add(owner);
    }
    // A subtree read whole (returnObjects) references every leaf under it.
    if (!enLeafSet.has(value) && isObject(getPath(enMerged, value))) {
      const p = `${value}.`;
      if (!prefixIndex.has(p)) prefixIndex.set(p, new Set());
      prefixIndex.get(p).add(owner);
    }
  }
}
for (const [prefix, owners] of prefixIndex) {
  for (const leaf of enLeaves) {
    if (leaf.startsWith(prefix)) for (const o of owners) refs.get(leaf).add(o);
  }
}

/** The nav labels each module's items use. */
const navLabels = new Map(); // leaf -> module
for (const id of modules) {
  for (const key of navItemKeys(id)) {
    const prefixes = [`nav.${key}`, `layout.pageTitle.${key}`, `managePage.rail.${key}`, `dashboard.site.${key}`];
    for (const leaf of enLeaves) {
      if (prefixes.some((p) => leaf === p || leaf.startsWith(`${p}.`))) {
        const core = staticRefsByOwner.get(leaf);
        if (core?.has('core')) {
          console.error(`ERROR: ${leaf} is ${id}'s nav label but core code names it directly`);
          process.exit(1);
        }
        navLabels.set(leaf, id);
      }
    }
  }
}

/** leaf -> { owner: 'core' | <module>, why } */
const decision = new Map();
const unsure = [];
const deadInCore = [];
const shared = [];

function ownersUnder(prefix) {
  const owners = new Set();
  for (const leaf of enLeaves) {
    if (leaf.startsWith(`${prefix}.`)) for (const o of refs.get(leaf)) owners.add(o);
  }
  return owners;
}

for (const leaf of enLeaves) {
  if (navLabels.has(leaf)) {
    decision.set(leaf, { owner: navLabels.get(leaf), why: 'nav label' });
    continue;
  }
  const owners = refs.get(leaf);
  if (owners.size === 1 && !owners.has('core')) {
    decision.set(leaf, { owner: [...owners][0], why: 'referenced' });
    continue;
  }
  if (owners.size > 1 && [...owners].some((o) => o !== 'core')) {
    decision.set(leaf, { owner: 'core', why: 'shared' });
    shared.push({ leaf, owners: [...owners].sort() });
    continue;
  }
  if (owners.size > 0) {
    decision.set(leaf, { owner: 'core', why: 'core' });
    continue;
  }
  // Nothing names it: ask its parents.
  const parts = leaf.split('.');
  let settled = false;
  for (let n = parts.length - 1; n >= 1; n--) {
    const parentOwners = ownersUnder(parts.slice(0, n).join('.'));
    if (parentOwners.size === 0) continue;
    if (parentOwners.size === 1 && !parentOwners.has('core')) {
      decision.set(leaf, { owner: [...parentOwners][0], why: 'inherited' });
    } else if (parentOwners.size === 1) {
      decision.set(leaf, { owner: 'core', why: 'inherited' });
    } else {
      decision.set(leaf, { owner: 'core', why: 'unsure' });
      unsure.push({ leaf, reason: `unreferenced; ${parts.slice(0, n).join('.')} is used by ${[...parentOwners].sort().join(' + ')}` });
    }
    settled = true;
    break;
  }
  // A whole top-level group nothing names is core's dead weight, not a
  // question of which module it belongs to.
  if (!settled) {
    decision.set(leaf, { owner: 'core', why: 'unreferenced' });
    deadInCore.push(leaf);
  }
}

/** en leaf -> module, for the leaves that move */
const moving = new Map([...decision].filter(([, d]) => d.owner !== 'core').map(([l, d]) => [l, d.owner]));

/** The module a leaf of any language belongs to, via the English leaf it is a form of. */
function movingModule(leaf) {
  if (moving.has(leaf)) return moving.get(leaf);
  const m = leaf.match(PLURAL);
  if (m && moving.has(`${m[1]}_other`)) return moving.get(`${m[1]}_other`);
  return undefined;
}

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

const movedPerModule = new Map();
if (WRITE && moving.size > 0) {
  for (const lang of languages) {
    /** module -> object for this language */
    const bundles = new Map();
    for (const id of modules) {
      const p = path.join(INTEGRATIONS, id, 'locales', `${lang}.json`);
      bundles.set(id, fs.existsSync(p) ? readJson(p) : {});
    }
    for (const file of topicFiles(lang)) {
      const json = readJson(file);
      let changed = false;
      for (const leaf of leaves(json)) {
        const id = movingModule(leaf);
        if (!id) continue;
        const target = bundles.get(id);
        if (getPath(target, leaf) !== undefined) {
          console.error(`ERROR: ${lang}: ${id} already has ${leaf}`);
          process.exit(1);
        }
        setPath(target, leaf, getPath(json, leaf));
        deletePath(json, leaf);
        changed = true;
        if (lang === 'en') movedPerModule.set(id, (movedPerModule.get(id) ?? 0) + 1);
      }
      if (changed) writeJson(file, json);
    }
    for (const [id, bundle] of bundles) {
      if (Object.keys(bundle).length > 0) {
        writeJson(path.join(INTEGRATIONS, id, 'locales', `${lang}.json`), bundle);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const byModule = new Map();
for (const [leaf, id] of moving) {
  if (!byModule.has(id)) byModule.set(id, []);
  byModule.get(id).push(leaf);
}
console.log(`${enLeaves.length} English keys in core; ${languages.length} languages.`);
if (moving.size === 0) console.log('Nothing to move: no core key is used by one module only.');
for (const [id, list] of byModule) {
  const nav = list.filter((l) => decision.get(l).why === 'nav label').length;
  const inherited = list.filter((l) => decision.get(l).why === 'inherited').length;
  console.log(
    `${WRITE ? 'moved' : 'to move'} to ${id}: ${list.length} keys per language ` +
      `(${nav} nav labels, ${inherited} unreferenced but under ${id}-only parents)`
  );
  if (LIST) {
    for (const l of list) {
      const why = decision.get(l).why;
      console.log(`    ${l}${why === 'referenced' ? '' : `  [${why}]`}`);
    }
  }
}
if (WRITE) {
  for (const [id, n] of movedPerModule) console.log(`  en leaves written for ${id}: ${n}`);
}
console.log(`shared (core + a module, or two modules), kept in core: ${shared.length}`);
for (const s of shared) {
  if (s.owners.includes('core')) continue;
  console.log(`    ${s.leaf}  (${s.owners.join(' + ')})`);
}
const sharedByTop = new Map();
for (const s of shared) {
  const top = s.leaf.split('.').slice(0, 2).join('.');
  sharedByTop.set(top, (sharedByTop.get(top) ?? 0) + 1);
}
if (LIST) for (const [top, n] of sharedByTop) console.log(`    ${top}.*: ${n}`);
const deadGroups = [...new Set(deadInCore.map((l) => l.split('.')[0]))];
console.log(
  `unreferenced by any code, kept in core: ${deadInCore.length} (${deadGroups.map((g) => `${g}.*`).join(', ')})`
);
console.log(`unsure, kept in core: ${unsure.length}`);
for (const u of unsure) console.log(`    ${u.leaf}  (${u.reason})`);
