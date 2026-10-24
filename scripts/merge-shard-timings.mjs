#!/usr/bin/env node
// Merges per-file durations (seconds) from Playwright JSON reports into a weights file.
//   node scripts/merge-shard-timings.mjs <weights.json> <report.json>...
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const [target, ...reports] = process.argv.slice(2);
if (!target || reports.length === 0) {
  console.error('usage: merge-shard-timings.mjs <weights.json> <report.json>...');
  process.exit(2);
}

const weights = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : {};
const seconds = {};

function walk(suite, dir) {
  for (const spec of suite.specs ?? []) {
    const file = `${dir}/${spec.file}`;
    for (const t of spec.tests ?? []) {
      for (const r of t.results ?? [])
        if (r.status !== 'interrupted') seconds[file] = (seconds[file] ?? 0) + r.duration / 1000;
    }
  }
  for (const s of suite.suites ?? []) walk(s, dir);
}

for (const path of reports) {
  if (!existsSync(path)) continue;
  const report = JSON.parse(readFileSync(path, 'utf8'));
  if (report.errors?.length) continue;
  const dir = (report.config?.rootDir ?? '').replace(/\\/g, '/').split('/').slice(-1)[0] || 'tests';
  for (const s of report.suites ?? []) walk(s, dir);
}

for (const [file, s] of Object.entries(seconds)) weights[file] = Math.round(s * 10) / 10;
const sorted = Object.fromEntries(Object.entries(weights).sort(([a], [b]) => a.localeCompare(b)));
const tmp = `${target}.tmp.${process.pid}`;
writeFileSync(tmp, `${JSON.stringify(sorted, null, 2)}\n`);
renameSync(tmp, target);
console.log(`timings: ${Object.keys(seconds).length} files merged into ${target}`);
