/**
 * `satisfies(version, range)` for the ranges a `module.json` declares
 * (`"clientApi": "^0.1.0"`), following node-semver's rules.
 *
 * Why not the `semver` package: the client workspace would get it nested
 * (the root holds semver 6 for other tools), and the image build copies only
 * the root `node_modules`. The subset needed here is small and fully covered
 * by `tests/api/module-client-loader.spec.ts`.
 *
 * Supported: exact versions, `=`, `<`, `<=`, `>`, `>=`, x-ranges (`1.x`,
 * `1.2.*`, `*`, partial versions), `^`, `~`, hyphen ranges (`1.0.0 - 2.0.0`),
 * space for AND and `||` for OR. Prerelease tags are compared, but a
 * prerelease version only satisfies a comparator on the same major.minor.patch
 * with a prerelease, as in node-semver.
 */

type Version = { major: number; minor: number; patch: number; pre: string[] };
type Comparator = { op: '<' | '<=' | '>' | '>=' | '='; v: Version };

const NUM = '0|[1-9]\\d*';
const PART = `(${NUM}|x|X|\\*)`;
const PRE = '(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?';
const VERSION = new RegExp(`^(${NUM})\\.(${NUM})\\.(${NUM})${PRE}$`);
const PARTIAL = new RegExp(`^v?${PART}(?:\\.${PART}(?:\\.${PART}${PRE})?)?$`);

function parseVersion(text: string): Version | null {
  const m = VERSION.exec(text.trim().replace(/^v/, ''));
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}

function comparePre(a: string[], b: string[]): number {
  if (!a.length || !b.length) return a.length ? -1 : b.length ? 1 : 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const an = /^\d+$/.test(a[i]);
    const bn = /^\d+$/.test(b[i]);
    if (an && bn && +a[i] !== +b[i]) return +a[i] < +b[i] ? -1 : 1;
    if (an !== bn) return an ? -1 : 1;
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function compare(a: Version, b: Version): number {
  return (
    Math.sign(a.major - b.major) ||
    Math.sign(a.minor - b.minor) ||
    Math.sign(a.patch - b.patch) ||
    comparePre(a.pre, b.pre)
  );
}

const isX = (part: string | undefined) => part === undefined || /^[xX*]$/.test(part);
const v = (major: number, minor: number, patch: number, pre: string[] = []): Version => ({
  major,
  minor,
  patch,
  pre,
});

/** A partial version (`1`, `1.2`, `1.x`, `1.2.3-beta`), or null. */
function parsePartial(text: string) {
  const m = PARTIAL.exec(text);
  if (!m) return null;
  const [, maj, min, pat, pre] = m;
  return {
    major: isX(maj) ? null : +maj,
    minor: isX(min) ? null : +min,
    patch: isX(pat) ? null : +pat,
    pre: pre ? pre.split('.') : [],
  };
}

/** One range token (`^1.2.3`, `>=1.0.0`, `1.x`) as comparators, or null when it is not one. */
function expand(token: string): Comparator[] | null {
  const m = /^(\^|~>?|>=|<=|>|<|=)?\s*(.+)$/.exec(token);
  if (!m) return null;
  const op = m[1] ?? '';
  const p = parsePartial(m[2]);
  if (!p) return null;
  const { major, minor, patch, pre } = p;

  if (major === null) {
    // `*`, `x`, `>=*`: anything. `<*` / `>*`: nothing.
    return op === '<' || op === '>' ? [{ op: '<', v: v(0, 0, 0, ['0']) }] : [];
  }

  if (op === '^') {
    const lo = v(major, minor ?? 0, patch ?? 0, pre);
    let hi: Version;
    if (major > 0 || minor === null) hi = v(major + 1, 0, 0, ['0']);
    else if (minor > 0 || patch === null) hi = v(0, minor + 1, 0, ['0']);
    else hi = v(0, 0, patch + 1, ['0']);
    return [{ op: '>=', v: lo }, { op: '<', v: hi }];
  }
  if (op === '~' || op === '~>') {
    const lo = v(major, minor ?? 0, patch ?? 0, pre);
    const hi = minor === null ? v(major + 1, 0, 0, ['0']) : v(major, minor + 1, 0, ['0']);
    return [{ op: '>=', v: lo }, { op: '<', v: hi }];
  }

  if (minor === null || patch === null) {
    // An x-range: `1.x` is >=1.0.0 <2.0.0-0, `1.2.x` is >=1.2.0 <1.3.0-0.
    const lo = v(major, minor ?? 0, 0);
    const hi = minor === null ? v(major + 1, 0, 0, ['0']) : v(major, minor + 1, 0, ['0']);
    switch (op) {
      case '':
      case '=':
        return [{ op: '>=', v: lo }, { op: '<', v: hi }];
      case '>=':
        return [{ op: '>=', v: lo }];
      case '<':
        return [{ op: '<', v: v(lo.major, lo.minor, 0, ['0']) }];
      case '>':
        return [{ op: '>=', v: hi }];
      case '<=':
        return [{ op: '<', v: hi }];
    }
  }

  return [{ op: (op || '=') as Comparator['op'], v: v(major, minor!, patch!, pre) }];
}

/** The range as OR-ed sets of AND-ed comparators, or null when it is not a range. */
function parseRange(range: string): Comparator[][] | null {
  const sets: Comparator[][] = [];
  for (const raw of range.split('||')) {
    const part = raw.trim().replace(/(\^|~>?|>=|<=|>|<|=)\s+/g, '$1');
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(part);
    if (hyphen) {
      const from = expand(`>=${hyphen[1]}`);
      const to = parsePartial(hyphen[2]);
      if (!from || !to || to.major === null) return null;
      const upper: Comparator =
        to.minor === null
          ? { op: '<', v: v(to.major + 1, 0, 0, ['0']) }
          : to.patch === null
            ? { op: '<', v: v(to.major, to.minor + 1, 0, ['0']) }
            : { op: '<=', v: v(to.major, to.minor, to.patch, to.pre) };
      sets.push([...from, upper]);
      continue;
    }
    const set: Comparator[] = [];
    for (const token of part === '' ? ['*'] : part.split(/\s+/)) {
      const comparators = expand(token);
      if (!comparators) return null;
      set.push(...comparators);
    }
    sets.push(set);
  }
  return sets;
}

function test(c: Comparator, version: Version): boolean {
  const cmp = compare(version, c.v);
  switch (c.op) {
    case '<':
      return cmp < 0;
    case '<=':
      return cmp <= 0;
    case '>':
      return cmp > 0;
    case '>=':
      return cmp >= 0;
    default:
      return cmp === 0;
  }
}

/** True when `range` parses as a semver range. */
export function isValidRange(range: string): boolean {
  return parseRange(range) !== null;
}

/** node-semver's `satisfies(version, range)` for the syntax above. False for anything unparsable. */
export function satisfies(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  const sets = parseRange(range);
  if (!parsed || !sets) return false;
  return sets.some((set) => {
    if (!set.every((c) => test(c, parsed))) return false;
    if (!parsed.pre.length) return true;
    // A prerelease only matches a comparator that names the same tuple with a prerelease.
    return set.some(
      (c) =>
        c.v.pre.length > 0 &&
        !(c.v.pre.length === 1 && c.v.pre[0] === '0') &&
        c.v.major === parsed.major &&
        c.v.minor === parsed.minor &&
        c.v.patch === parsed.patch
    );
  });
}
