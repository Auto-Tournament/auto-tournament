import fs from 'node:fs';
import path from 'node:path';

function parseJsonString(src, startIdx) {
  // src[startIdx] === '"'
  let i = startIdx + 1;
  let out = '';
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') return { value: out, next: i + 1 };
    if (ch === '\\') {
      const n = src[i + 1];
      if (n === '"' || n === '\\' || n === '/') {
        out += n;
        i += 2;
        continue;
      }
      if (n === 'b') {
        out += '\b';
        i += 2;
        continue;
      }
      if (n === 'f') {
        out += '\f';
        i += 2;
        continue;
      }
      if (n === 'n') {
        out += '\n';
        i += 2;
        continue;
      }
      if (n === 'r') {
        out += '\r';
        i += 2;
        continue;
      }
      if (n === 't') {
        out += '\t';
        i += 2;
        continue;
      }
      if (n === 'u') {
        const hex = src.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 6;
          continue;
        }
      }
      // Unknown escape: keep the escaped char as-is
      out += n ?? '';
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  throw new Error('Unterminated string');
}

function findDuplicateJsonKeys(src) {
  /** @type {{ path: string, key: string }[]} */
  const duplicates = [];

  /**
   * @type {{
   *  type: 'object'|'array',
   *  state: 'keyOrEnd'|'colon'|'value'|'valueOrEnd'|'commaOrEnd',
   *  path: string[],
   *  keys?: Set<string>,
   *  lastKey?: string
   * }[]}
   */
  const stack = [];

  const top = () => stack[stack.length - 1];

  const setParentValueComplete = () => {
    const parent = top();
    if (!parent) return;
    parent.state = 'commaOrEnd';
  };

  const pushObject = (pathParts) => {
    stack.push({ type: 'object', state: 'keyOrEnd', path: pathParts, keys: new Set(), lastKey: undefined });
  };

  const pushArray = (pathParts) => {
    stack.push({ type: 'array', state: 'valueOrEnd', path: pathParts });
  };

  const skipWs = (idx) => {
    let i = idx;
    while (i < src.length) {
      const ch = src[i];
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') i++;
      else break;
    }
    return i;
  };

  const consumePrimitive = (idx) => {
    let i = idx;
    while (i < src.length) {
      const ch = src[i];
      if (ch === ',' || ch === ']' || ch === '}' || ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') break;
      i++;
    }
    return i;
  };

  let i = skipWs(0);
  while (i < src.length) {
    i = skipWs(i);
    const ch = src[i];
    const ctx = top();

    if (ch === '{') {
      if (!ctx) {
        pushObject([]);
      } else if (ctx.type === 'object' && ctx.state === 'value') {
        pushObject(ctx.path.concat(ctx.lastKey ?? ''));
        setParentValueComplete();
      } else if (ctx.type === 'array' && ctx.state === 'valueOrEnd') {
        pushObject(ctx.path);
        setParentValueComplete();
      } else {
        pushObject(ctx.path);
      }
      i++;
      continue;
    }

    if (ch === '[') {
      if (!ctx) {
        pushArray([]);
      } else if (ctx.type === 'object' && ctx.state === 'value') {
        pushArray(ctx.path.concat(ctx.lastKey ?? ''));
        setParentValueComplete();
      } else if (ctx.type === 'array' && ctx.state === 'valueOrEnd') {
        pushArray(ctx.path);
        setParentValueComplete();
      } else {
        pushArray(ctx.path);
      }
      i++;
      continue;
    }

    if (ch === '}' || ch === ']') {
      stack.pop();
      i++;
      continue;
    }

    if (ch === ':') {
      if (ctx && ctx.type === 'object' && ctx.state === 'colon') ctx.state = 'value';
      i++;
      continue;
    }

    if (ch === ',') {
      if (ctx) {
        ctx.state = ctx.type === 'object' ? 'keyOrEnd' : 'valueOrEnd';
      }
      i++;
      continue;
    }

    if (ch === '"') {
      const s = parseJsonString(src, i);
      i = s.next;

      const cur = top();
      if (cur && cur.type === 'object' && cur.state === 'keyOrEnd') {
        const key = s.value;
        if (cur.keys?.has(key)) {
          duplicates.push({ path: cur.path.concat(key).join('.'), key });
        } else {
          cur.keys?.add(key);
        }
        cur.lastKey = key;
        cur.state = 'colon';
      } else {
        // string value
        if (cur && ((cur.type === 'object' && cur.state === 'value') || (cur.type === 'array' && cur.state === 'valueOrEnd'))) {
          setParentValueComplete();
        }
      }
      continue;
    }

    // primitive value (number/true/false/null)
    if (ctx && ((ctx.type === 'object' && ctx.state === 'value') || (ctx.type === 'array' && ctx.state === 'valueOrEnd'))) {
      i = consumePrimitive(i);
      setParentValueComplete();
      continue;
    }

    i++;
  }

  return duplicates;
}

function listJsonFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listJsonFiles(p));
    else if (ent.isFile() && p.endsWith('.json')) out.push(p);
  }
  return out;
}

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

const repoRoot = path.resolve(process.cwd(), '..');
const localesDir = path.join(repoRoot, 'client', 'src', 'locales');

/** @type {string[]} */
const targets = [];

// Any locale using split `translation/` folder (e.g. en, zh-CN)
if (exists(localesDir)) {
  for (const ent of fs.readdirSync(localesDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const splitDir = path.join(localesDir, ent.name, 'translation');
    if (exists(splitDir)) targets.push(...listJsonFiles(splitDir));
  }
}

// Other locales that still use translation.json
if (exists(localesDir)) {
  for (const ent of fs.readdirSync(localesDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const p = path.join(localesDir, ent.name, 'translation.json');
    if (exists(p)) targets.push(p);
  }
}

/** @type {{ file: string, dups: {path:string, key:string}[] }[]} */
const failures = [];

for (const file of targets) {
  const txt = fs.readFileSync(file, 'utf8');
  try {
    JSON.parse(txt);
  } catch (e) {
    failures.push({ file, dups: [{ path: '(invalid-json)', key: String(e?.message ?? e) }] });
    continue;
  }

  const dups = findDuplicateJsonKeys(txt);
  if (dups.length) failures.push({ file, dups });
}

if (failures.length) {
  // eslint-disable-next-line no-console
  console.error('Duplicate JSON keys detected:\\n');
  for (const f of failures) {
    // eslint-disable-next-line no-console
    console.error(`- ${path.relative(repoRoot, f.file)}`);
    const unique = new Set(f.dups.map((d) => d.path));
    for (const p of unique) {
      // eslint-disable-next-line no-console
      console.error(`  - ${p}`);
    }
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log(`OK: No duplicate JSON keys in ${targets.length} file(s).`);
