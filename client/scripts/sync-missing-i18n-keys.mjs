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

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

/**
 * Deep-add missing keys from `source` into `target` (mutates `target`).
 * Never overwrites existing non-object values.
 */
function mergeMissing(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (!(k in target)) {
      target[k] = v;
      continue;
    }

    const tv = target[k];
    if (isPlainObject(tv) && isPlainObject(v)) {
      mergeMissing(tv, v);
    }
  }
}

const repoRoot = path.resolve(process.cwd(), '..');
const localesDir = path.join(repoRoot, 'client', 'src', 'locales');

if (!exists(localesDir)) {
  console.error('ERROR: locales dir not found:', localesDir);
  process.exit(1);
}

const enDir = path.join(localesDir, 'en', 'translation');
if (!exists(enDir)) {
  console.error('ERROR: English translation dir not found:', enDir);
  process.exit(1);
}

const enFiles = fs.readdirSync(enDir).filter((f) => f.endsWith('.json')).sort((a, b) => a.localeCompare(b));
/** @type {Map<string, any>} */
const enByFile = new Map(enFiles.map((f) => [f, readJson(path.join(enDir, f))]));

const locales = fs
  .readdirSync(localesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((name) => name !== 'en')
  .sort((a, b) => a.localeCompare(b));

let filesChanged = 0;

for (const locale of locales) {
  const dir = path.join(localesDir, locale, 'translation');
  if (!exists(dir)) continue;

  for (const f of enFiles) {
    const targetPath = path.join(dir, f);
    const enObj = enByFile.get(f);
    if (!enObj) continue;

    /** @type {any} */
    const before = exists(targetPath) ? readJson(targetPath) : {};
    /** @type {any} */
    const after = structuredClone(before);
    mergeMissing(after, enObj);

    if (JSON.stringify(before) !== JSON.stringify(after)) {
      writeJson(targetPath, after);
      filesChanged++;
    }
  }
}

console.log(`i18n sync complete: updated ${filesChanged} file(s).`);
