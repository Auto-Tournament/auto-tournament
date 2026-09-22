#!/usr/bin/env node
/**
 * Fails when api/src hard-codes the tournament id.
 *
 * 3.0 hosts a single tournament row (id 1). The id is threaded through as a
 * parameter so 3.1 only has to change where it comes from:
 * `api/src/utils/tournamentRow.ts` (LEGACY_TOURNAMENT_ID, resolveTournamentId,
 * tournamentIdForMatch) is the one place allowed to know about the row. This
 * check keeps new `WHERE id = 1`-style shortcuts from creeping back in.
 *
 * Usage: node scripts/check-tournament-literals.mjs [srcDir]
 * A line can opt out with a `tournament-literal-ok` comment (use sparingly).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const srcDir = resolve(process.argv[2] ?? join(repoRoot, 'api/src'));

// Files allowed to mention the single row: the definition and the schema
// (its CHECK (id = 1) / DEFAULT 1 stay until 3.1 drops them).
const ALLOWED = new Set(['utils/tournamentRow.ts', 'config/database.schema.ts']);

/** Line patterns: each names what it catches. */
const LINE_PATTERNS = [
  // SQL: WHERE id = 1, tournament_id = 1 (not team1_id: \b needs a non-word char before "id")
  { re: /\b(?:id|tournament_id)\s*=\s*'?1'?(?![\d.])/, what: 'SQL id literal (`id = 1` / `tournament_id = 1`)' },
  // Object literals / inserts: tournament_id: 1, tournamentId: 1, { id: 1 }
  { re: /\b(?:tournament_id|tournamentId|id)\s*:\s*1(?![\d.])\b/, what: 'object literal id 1' },
  // Default parameters and assignments: tournamentId = 1, tournamentId: number = 1
  { re: /\btournamentId\s*(?::\s*number\s*)?=\s*1(?![\d.])\b/, what: 'tournamentId defaulted to 1' },
  // Fallbacks for standalone matches: tournament_id ?? 1, tournament_id || 1
  { re: /\btournament_?[iI]d\s*(?:\?\?|\|\|)\s*1(?![\d.])\b/, what: 'tournament id fallback to 1 (use tournamentIdForMatch)' },
  // Route params compared to the literal: id !== '1', id === 1
  { re: /\b(?:id|tournamentId)\s*[!=]==?\s*['"`]?1['"`]?(?![\d.])/, what: 'id compared to literal 1' },
  // Calls handing a tournament-scoped function the literal: checkTournamentCompletion(1)
  {
    re: /\b(?:\w*[Tt]ournament\w*|get\w*Standing\w*|advanceSwiss\w*)\(\s*1\s*[,)]/,
    what: 'tournament function called with literal 1',
  },
];

/**
 * Statement patterns (text between semicolons, comments stripped): a query or
 * update on the tournament row, or filtered by tournament_id, with `[1]` / `[1, ...]`
 * as its parameters.
 */
const STATEMENT_PATTERNS = [
  {
    re: /(?:\b(?:FROM|UPDATE|INTO|JOIN)\s+tournament\b|'tournament'|\btournament_id\s*=\s*\?)[\s\S]*?\[\s*1\s*[,\]]/,
    what: 'tournament query with [1] as parameters',
  },
];

function stripComments(source) {
  // Keep line structure so reported line numbers stay right.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\w])\/\/.*$/gm, '$1');
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules') continue;
      yield* walk(full);
    } else if (/\.(?:ts|tsx|js|mjs|cjs)$/.test(name) && !/\.d\.ts$/.test(name)) {
      yield full;
    }
  }
}

const findings = [];
for (const file of walk(srcDir)) {
  const rel = relative(srcDir, file).split('\\').join('/');
  if (ALLOWED.has(rel)) continue;

  const raw = readFileSync(file, 'utf8');
  const rawLines = raw.split('\n');
  const code = stripComments(raw);
  const lines = code.split('\n');
  const optedOut = (lineNo) => /tournament-literal-ok/.test(rawLines[lineNo - 1] ?? '');

  lines.forEach((line, i) => {
    for (const { re, what } of LINE_PATTERNS) {
      if (re.test(line) && !optedOut(i + 1)) {
        findings.push({ file: rel, line: i + 1, what, text: rawLines[i].trim() });
        break;
      }
    }
  });

  let offset = 0;
  for (const statement of code.split(';')) {
    for (const { re, what } of STATEMENT_PATTERNS) {
      const m = re.exec(statement);
      if (!m) continue;
      const endIdx = offset + m.index + m[0].length;
      const lineNo = code.slice(0, endIdx).split('\n').length;
      if (optedOut(lineNo) || findings.some((f) => f.file === rel && f.line === lineNo)) continue;
      findings.push({ file: rel, line: lineNo, what, text: rawLines[lineNo - 1].trim() });
    }
    offset += statement.length + 1;
  }
}

if (findings.length > 0) {
  console.error(`Hard-coded tournament id found (${findings.length}):\n`);
  for (const f of findings) {
    console.error(`  api/src/${f.file}:${f.line}  ${f.what}\n      ${f.text}`);
  }
  console.error(
    '\nPass the tournament id instead: resolveTournamentId(req) in routes, a `tournamentId`' +
      '\nparameter in services, or tournamentIdForMatch(match) when a match row is at hand' +
      '\n(api/src/utils/tournamentRow.ts).'
  );
  process.exit(1);
}
console.log('No hard-coded tournament ids in api/src.');
