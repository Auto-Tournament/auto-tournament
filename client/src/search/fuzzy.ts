/**
 * Fuzzy matching for the site search's pages, tabs and actions (siteIndex.ts),
 * searched in the browser. The same rules as the API's for players, teams and
 * the rest (api/src/utils/fuzzy.ts); tests/api/site-search.spec.ts runs one
 * table of queries through both.
 *
 * Every word of the query has to match some word of the text: exactly, as the
 * start of a word, inside a longer word, or with a typo (one edit in words of
 * four letters or more, two from eight; none in words with digits). Word order does not matter, case and
 * diacritics are ignored (ø, æ and å too), and the score says how well it
 * matched: 1 is the whole name typed exactly.
 */

const FOLD: Record<string, string> = {
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  đ: 'd',
  ð: 'd',
  ł: 'l',
  þ: 'th',
  ı: 'i',
};

/** Lower case, no diacritics, letters and digits only (anything else is a space). */
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[øæœßđðłþı]/g, (c) => FOLD[c] ?? c)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function words(text: string): string[] {
  return normalizeSearch(text).split(' ').filter(Boolean);
}

/** Optimal string alignment distance (Levenshtein plus swapped neighbours), stopping above `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) rows.push([i]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Number.POSITIVE_INFINITY;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, rows[i - 2][j - 2] + 1);
      }
      rows[i][j] = v;
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
  }
  return rows[a.length][b.length];
}

/** Edits a query word may have: none with digits in it (an id, a year), else by its length. */
function allowedTypos(word: string): number {
  if (/\d/.test(word)) return 0;
  return word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0;
}

/** How well one query word matches one word of the text: 0 not at all, 1 exactly. */
function wordScore(q: string, w: string): number {
  if (w === q) return 1;
  if (w.startsWith(q)) return 0.75 + 0.2 * (q.length / w.length);
  if (q.length >= 3 && w.includes(q)) return 0.6;
  const typos = allowedTypos(q);
  if (typos === 0) return 0;
  const whole = editDistance(q, w, typos);
  if (whole <= typos) return 0.7 - 0.1 * whole;
  // A typo in a word still being typed: "benchma" → "benchmark", "recrd" → "recorders".
  if (w.length > q.length) {
    const start = editDistance(q, w.slice(0, q.length), typos);
    if (start <= typos) return 0.55 - 0.1 * start;
  }
  return 0;
}

/** One field of an entry: its text and how much a hit in it counts (a name 1, extra search words less). */
export interface SearchField {
  text: string;
  weight?: number;
}

/**
 * The match quality of `query` against an entry's fields, 0 when some word of
 * the query matches nothing. Up to 1, plus a little when the whole query is how
 * a field starts or the field is exactly the query.
 */
export function fuzzyScore(query: string, fields: ReadonlyArray<SearchField | string>): number {
  const qs = words(query);
  if (qs.length === 0) return 0;
  const parsed = fields
    .map((f) =>
      typeof f === 'string' ? { text: f, weight: 1 } : { text: f.text, weight: f.weight ?? 1 }
    )
    .filter((f) => f.text)
    .map((f) => ({ norm: normalizeSearch(f.text), words: words(f.text), weight: f.weight }));
  let total = 0;
  for (const q of qs) {
    let best = 0;
    for (const f of parsed) {
      for (const w of f.words) best = Math.max(best, wordScore(q, w) * f.weight);
      // A query typed without its spaces: "csmanager", "redrawoverlays".
      if (q.length >= 5 && f.norm.replace(/ /g, '').includes(q))
        best = Math.max(best, 0.6 * f.weight);
    }
    if (best === 0) return 0;
    total += best;
  }
  let score = total / qs.length;
  const whole = qs.join(' ');
  for (const f of parsed) {
    if (f.norm === whole) score += 0.3 * f.weight;
    else if (f.norm.startsWith(whole)) score += 0.15 * f.weight;
  }
  return score;
}

/**
 * The items that match `query`, best first (ties keep their order), at most
 * `limit`. `fieldsOf` gives each item's fields.
 */
export function fuzzyRank<T>(
  query: string,
  items: readonly T[],
  fieldsOf: (item: T) => ReadonlyArray<SearchField | string>,
  limit = Number.POSITIVE_INFINITY
): Array<{ item: T; score: number }> {
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, fieldsOf(item)) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ item, score }) => ({ item, score }));
}
