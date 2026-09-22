#!/usr/bin/env node
/**
 * Prints the spec files one CI E2E shard should run, balanced by duration.
 *
 *   node tests/ci-shard.mjs <shard> <total>          # space-separated file list
 *   node tests/ci-shard.mjs --summary <total>        # every shard's files + weight
 *
 * Why not `playwright test --shard=i/n`: Playwright splits by test count in
 * file order, and this suite is fast API specs first, slow UI specs last. With
 * four shards that gave Playwright runs of ~50s / ~50s / ~100s / ~160s, so the
 * last shard set the wall clock. Packing whole files by measured duration
 * evens that out.
 *
 * Whole files only: a file is never split, so a test.describe.serial block and
 * any other state shared inside a file always stays on one shard (and its
 * Postgres), exactly as in an unsharded run.
 *
 * Every spec file under tests/ is assigned to exactly one shard. Files missing
 * from tests/ci-shard-weights.json get DEFAULT_WEIGHT, so a new spec is still
 * run — the weights only affect balance. Refresh them from a CI run's
 * per-test durations when the balance drifts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_WEIGHT = 5;
const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(testsDir);

// Playwright's default testMatch.
const SPEC = /\.(spec|test)\.[cm]?[jt]sx?$/;

function listSpecs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSpecs(full));
    else if (SPEC.test(entry.name)) out.push(relative(repoRoot, full).split('\\').join('/'));
  }
  return out;
}

function partition(total) {
  const weights = JSON.parse(readFileSync(join(testsDir, 'ci-shard-weights.json'), 'utf8'));
  const files = listSpecs(testsDir).map((file) => ({
    file,
    weight: weights[file] ?? DEFAULT_WEIGHT,
  }));
  // Heaviest first into the lightest shard. Ties break on name and shard index
  // so every shard computes the same partition.
  files.sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file));
  const shards = Array.from({ length: total }, () => ({ weight: 0, files: [] }));
  for (const f of files) {
    let target = shards[0];
    for (const s of shards) if (s.weight < target.weight) target = s;
    target.files.push(f.file);
    target.weight += f.weight;
  }
  for (const s of shards) s.files.sort();
  return shards;
}

const args = process.argv.slice(2);
if (args[0] === '--summary') {
  const total = Number(args[1]);
  partition(total).forEach((s, i) => {
    console.log(`shard ${i + 1}/${total}: ~${Math.round(s.weight)}s, ${s.files.length} files`);
    for (const f of s.files) console.log(`  ${f}`);
  });
} else {
  const shard = Number(args[0]);
  const total = Number(args[1]);
  if (!Number.isInteger(shard) || !Number.isInteger(total) || shard < 1 || shard > total) {
    console.error('usage: node tests/ci-shard.mjs <shard> <total> | --summary <total>');
    process.exit(2);
  }
  const { files } = partition(total)[shard - 1];
  if (files.length === 0) {
    console.error(`shard ${shard}/${total} has no spec files`);
    process.exit(1);
  }
  console.log(files.join(' '));
}
