#!/usr/bin/env node
/**
 * Third-party notices for what Auto Tournament ships: the npm packages in the
 * production dependency trees of api/ (the server) and client/ (bundled into
 * the browser app). Writes THIRD_PARTY_NOTICES.md with each package's name,
 * version, license and license text, as MIT/BSD/Apache and similar licenses
 * ask of anyone distributing the code.
 *
 *   node scripts/third-party-notices.mjs           write THIRD_PARTY_NOTICES.md
 *   node scripts/third-party-notices.mjs --check   fail if a package's license is
 *                                                  not on the allowed list (CI)
 *
 * The file is generated where the image is built, from the dependencies
 * installed there (docker/Dockerfile, and CI's prebuilt bundle), so it always
 * matches what ships; it is not committed.
 *
 * The worker (Go) has its own list: worker/THIRD_PARTY_NOTICES.md.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'THIRD_PARTY_NOTICES.md');

/**
 * Licenses that allow shipping the package inside a PolyForm Noncommercial
 * product with the notice kept. Anything else fails --check and needs a look
 * (copyleft such as GPL/AGPL/LGPL would not fit, and an unknown license might
 * not either).
 */
const ALLOWED = new Set([
  'MIT', 'MIT-0', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'Zlib', 'Unlicense', 'CC0-1.0',
  'CC-BY-4.0', 'CC-BY-3.0', 'BlueOak-1.0.0', 'Python-2.0', 'OFL-1.1', 'WTFPL', 'Artistic-2.0',
]);

const LICENSE_FILES = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown|mit|bsd))?$/i;

/**
 * Packages whose package.json names no license, checked by hand (2026-10-08).
 * If one of these changes version, check it again.
 */
const KNOWN = {
  'emitter-component@1.1.2': 'MIT', // component.json: "license": "MIT"
  'pause@0.0.1': 'MIT', // Readme: "## License (The MIT License)"
  'steam-web@0.4.0': 'MIT', // LICENSE.md: the MIT text
};

const STANDARD = {
  MIT: `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
  ISC: `Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
};

/**
 * The license's standard text with the author from package.json, for a
 * package that declares MIT or ISC but ships no text of it.
 */
function standardText(license, meta) {
  const body = STANDARD[license];
  if (!body) return '';
  const author = typeof meta.author === 'string' ? meta.author : meta.author?.name;
  return `${author ? `Copyright (c) ${author}\n\n` : ''}${body}\n\n(The package declares ${license} and ships no license file; this is the standard ${license} text.)`;
}

/** A README's license section, for packages that keep it there instead of in a file. */
function readmeLicense(dir) {
  const readme = fs.readdirSync(dir).find((f) => /^readme(\.(md|markdown|txt))?$/i.test(f));
  if (!readme) return '';
  const text = fs.readFileSync(path.join(dir, readme), 'utf8');
  const m = /^#+\s*licen[cs]e[^\n]*\n([\s\S]*?)(?=^#+\s|$(?![\s\S]))/im.exec(text);
  return m ? m[0].trim() : '';
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Where `name` resolves from `fromDir`, the way Node looks it up. */
function resolvePackage(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(candidate)) return path.dirname(candidate);
    const parent = path.dirname(dir);
    if (parent === dir || !parent.startsWith(ROOT)) return null;
    dir = parent;
  }
}

function licenseOf(pkg) {
  const l = pkg.license ?? pkg.licenses;
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) return l.map((x) => (typeof x === 'string' ? x : x.type)).join(' OR ');
  if (l && typeof l === 'object' && l.type) return l.type;
  return 'UNKNOWN';
}

/** Every SPDX id in an expression is allowed (OR: one side is enough). */
function allowed(expr) {
  const clean = expr.replace(/[()]/g, ' ').trim();
  if (/\bOR\b/.test(clean)) return clean.split(/\bOR\b/).some((part) => allowed(part));
  return clean.split(/\bAND\b/).every((part) => ALLOWED.has(part.trim().replace(/\*$/, '')));
}

function collect(workspace, found) {
  const dir = path.join(ROOT, workspace);
  const pkg = readJson(path.join(dir, 'package.json'));
  const queue = Object.keys(pkg.dependencies ?? {}).map((name) => [name, dir]);
  while (queue.length) {
    const [name, from] = queue.shift();
    const at = resolvePackage(name, from);
    if (!at) continue; // optional or platform-specific, not installed here
    const meta = readJson(path.join(at, 'package.json'));
    const key = `${meta.name}@${meta.version}`;
    if (found.has(key)) {
      found.get(key).usedBy.add(workspace);
      continue;
    }
    const files = fs.readdirSync(at).filter((f) => LICENSE_FILES.test(f));
    const declared = licenseOf(meta);
    found.set(key, {
      name: meta.name,
      version: meta.version,
      license: declared === 'UNKNOWN' && KNOWN[key] ? KNOWN[key] : declared,
      text: files.length
        ? files.map((f) => fs.readFileSync(path.join(at, f), 'utf8').trim()).join('\n\n')
        : readmeLicense(at) || standardText(declared === 'UNKNOWN' && KNOWN[key] ? KNOWN[key] : declared, meta),
      repository: typeof meta.repository === 'string' ? meta.repository : meta.repository?.url ?? meta.homepage ?? '',
      usedBy: new Set([workspace]),
    });
    for (const dep of Object.keys(meta.dependencies ?? {})) queue.push([dep, at]);
    for (const dep of Object.keys(meta.optionalDependencies ?? {})) queue.push([dep, at]);
  }
}

const found = new Map();
collect('api', found);
collect('client', found);
const packages = [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const lines = [
  '# Third-party notices',
  '',
  'Auto Tournament is under the PolyForm Noncommercial License 1.0.0 (LICENSE). It ships the',
  'third-party packages below: the server (api/) runs them and the web app (client/) bundles',
  'them. Each stays under its own license, reproduced here as those licenses ask. The worker',
  "(worker/) has its own list in worker/THIRD_PARTY_NOTICES.md. Generated by",
  '`node scripts/third-party-notices.mjs` when the image is built.',
  '',
  `${packages.length} packages.`,
  '',
];
for (const p of packages) {
  lines.push(`## ${p.name} ${p.version}`, '');
  lines.push(`License: ${p.license}${p.repository ? `  \nSource: ${p.repository}` : ''}  \nUsed by: ${[...p.usedBy].sort().join(', ')}`, '');
  if (p.text) lines.push('```', p.text.replace(/```/g, "'''"), '```', '');
  else lines.push(`_No license file in the package; its package.json says ${p.license}._`, '');
}
const text = lines.join('\n');

const bad = packages.filter((p) => !allowed(p.license));
if (process.argv.includes('--check')) {
  let failed = false;
  if (bad.length) {
    failed = true;
    console.error('Packages whose license is not on the allowed list:');
    for (const p of bad) console.error(`  ${p.name}@${p.version}: ${p.license}`);
  }
  if (!failed) console.log(`All ${packages.length} third-party packages have an allowed license.`);
  process.exit(failed ? 1 : 0);
}
fs.writeFileSync(OUT, text);
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${packages.length} packages.`);
if (bad.length) {
  console.log('Needs a look (license not on the allowed list):');
  for (const p of bad) console.log(`  ${p.name}@${p.version}: ${p.license}`);
}
