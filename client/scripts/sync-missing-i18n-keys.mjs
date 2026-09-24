/**
 * Copy keys a language lacks from English, for core's topic files and for
 * each module's namespace (`integrations/<id>/locales/<lang>.json`, created
 * when a module has no file for a language yet). Never overwrites a value a
 * language already has, so a translation is never replaced by English.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  CORE_NAMESPACE,
  exists,
  isPlainObject,
  languages,
  localesDir,
  namespaceFiles,
  namespaces,
  readJson,
} from './i18n-namespaces.mjs';

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
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

if (!exists(localesDir)) {
  console.error('ERROR: locales dir not found:', localesDir);
  process.exit(1);
}

const enDir = path.join(localesDir, 'en', 'translation');
if (!exists(enDir)) {
  console.error('ERROR: English translation dir not found:', enDir);
  process.exit(1);
}

const locales = languages().filter((name) => name !== 'en');

let filesChanged = 0;

for (const ns of namespaces()) {
  // Pairs each English file with the same file in another language: core's
  // topic files by name, a module's single file by language.
  const enFiles = namespaceFiles(ns, 'en').filter(exists);

  for (const locale of locales) {
    for (const enPath of enFiles) {
      const targetPath =
        ns === CORE_NAMESPACE
          ? path.join(localesDir, locale, 'translation', path.basename(enPath))
          : namespaceFiles(ns, locale)[0];
      const enObj = readJson(enPath);

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
}

console.log(`i18n sync complete: updated ${filesChanged} file(s).`);
