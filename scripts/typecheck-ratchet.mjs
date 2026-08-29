#!/usr/bin/env node
/**
 * Typecheck ratchet.
 *
 * The build uses esbuild (api) and Vite (client), both of which strip types
 * without checking them — so `tsc` errors have never failed anything. That is
 * how a real bug shipped: VetoMapCard declared a `mapName` prop but destructured
 * `_mapName`, so every veto map card rendered
 * `data-testid="veto-map-card-undefined"`. tsc had been reporting it the whole
 * time; the veto UI tests were deleted as "flaky" instead.
 *
 * There are too many pre-existing errors to fix in one go, so this ratchets
 * rather than gates: it fails when the count goes UP, and asks you to lower the
 * baseline when it goes down. The number can only shrink.
 *
 * Usage:
 *   node scripts/typecheck-ratchet.mjs           # check against the baseline
 *   node scripts/typecheck-ratchet.mjs --update  # rewrite the baseline
 */

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(repoRoot, 'scripts', 'typecheck-baseline.json');

// Run TypeScript's own entrypoint with the current node binary. Spawning `npx`
// or `tsc` directly breaks on Windows, where they are `.cmd` shims that Node 20+
// refuses to spawn without a shell (EINVAL).
const tscBin = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
if (!existsSync(tscBin)) {
  console.error(`Cannot find TypeScript at ${tscBin}. Run "yarn install" first.`);
  process.exit(1);
}

const PROJECTS = [
  { name: 'api', tsconfig: 'api/tsconfig.json' },
  { name: 'client', tsconfig: 'client/tsconfig.json' },
];

/**
 * Run tsc for one project and return its error count plus the matching lines.
 *
 * Distinguishes "tsc ran and found errors" from "tsc could not run". The latter
 * must never be reported as a clean zero — a ratchet that silently passes when
 * its own tooling is broken is worse than no ratchet at all.
 */
async function countErrors({ name, tsconfig }) {
  let output = '';

  try {
    const { stdout } = await execFileAsync(process.execPath, [tscBin, '-p', tsconfig, '--noEmit'], {
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
    output = stdout;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EINVAL' || error.signal) {
      throw new Error(`Failed to run tsc for ${name}: ${error.message}`);
    }

    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;

    if (output.trim() === '') {
      throw new Error(
        `tsc for ${name} exited with code ${error.code} but produced no output — ` +
          'treating this as a harness failure rather than a clean run.'
      );
    }
  }

  const lines = output.split('\n').filter((line) => /error TS\d+:/.test(line));
  return { count: lines.length, lines };
}

/** Group error lines by TS code so the summary points at what to fix first. */
function summarise(lines) {
  const byCode = new Map();
  for (const line of lines) {
    const code = line.match(/error (TS\d+):/)?.[1];
    if (code) byCode.set(code, (byCode.get(code) ?? 0) + 1);
  }
  return [...byCode.entries()].sort((a, b) => b[1] - a[1]);
}

const update = process.argv.includes('--update');

const results = {};
const details = {};

for (const project of PROJECTS) {
  process.stdout.write(`typechecking ${project.name}... `);
  const { count, lines } = await countErrors(project);
  results[project.name] = count;
  details[project.name] = lines;
  console.log(`${count} error(s)`);
}

if (update) {
  await writeFile(baselinePath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  console.log(`\nBaseline updated: ${JSON.stringify(results)}`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
} catch {
  console.error(
    `\nNo baseline at ${baselinePath}. Create one with:\n` +
      '  node scripts/typecheck-ratchet.mjs --update'
  );
  process.exit(1);
}

let failed = false;
let improved = false;

console.log('');

for (const { name } of PROJECTS) {
  const current = results[name];
  const allowed = baseline[name];

  if (typeof allowed !== 'number') {
    console.error(`x ${name}: no baseline entry — run with --update`);
    failed = true;
    continue;
  }

  if (current > allowed) {
    console.error(
      `x ${name}: ${current} type errors, up from ${allowed}. New type errors were introduced.`
    );
    for (const [code, n] of summarise(details[name]).slice(0, 5)) {
      console.error(`    ${code}: ${n}`);
    }
    failed = true;
  } else if (current < allowed) {
    console.log(`v ${name}: ${current} type errors, down from ${allowed}. Lower the baseline.`);
    improved = true;
  } else {
    console.log(`v ${name}: ${current} type errors (unchanged)`);
  }
}

if (failed) {
  console.error(
    '\nSee them with:  npx tsc -p <project>/tsconfig.json --noEmit\n' +
      'These do not break the build — esbuild and Vite skip type checking entirely,\n' +
      'which is exactly why they have to be caught here.'
  );
  process.exit(1);
}

if (improved) {
  console.log('\nCommit the lower numbers:\n  node scripts/typecheck-ratchet.mjs --update');
  process.exit(1);
}

console.log('\nNo new type errors.');
