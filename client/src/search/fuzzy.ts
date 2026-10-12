/**
 * Fuzzy search, the same in the browser (search/searchIndex.ts) and the API
 * (api/src/utils/fuzzy.ts is this file, word for word; a test keeps them so).
 *
 * Text is folded first: lower case, accents off, ø→o, æ→ae, ß→ss, anything
 * but letters and digits a space. Every word of the query must match a word
 * of the text, in any order:
 *   exact 1.0 · the start of it ("leader" → leaderboards) 0.9 ·
 *   inside it (3+ letters) 0.7 · one typo (4+ letters; two from 8) 0.6 ·
 *   one typo in its start ("leaderbaord" → leaderboards) 0.55.
 * The score is the mean over the query's words (0 when one has no match).
 */

export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function words(text: string): string[] {
  return fold(text).split(' ').filter(Boolean);
}

/** Edit distance with swaps (optimal string alignment), stopping above `max`. */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = new Array(b.length + 1).fill(0);
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

/** How well a query word matches a text word, 0–1. */
export function wordScore(q: string, w: string): number {
  if (q === w) return 1;
  if (w.startsWith(q)) return 0.9;
  if (q.length >= 3 && w.includes(q)) return 0.7;
  if (q.length >= 4) {
    const max = q.length >= 8 ? 2 : 1;
    if (distance(q, w, max) <= max) return 0.6;
    if (w.length > q.length && distance(q, w.slice(0, q.length), 1) <= 1) return 0.55;
  }
  return 0;
}

/**
 * How well `query` matches `text`, 0–1 (0: some query word matches nothing).
 * Pre-split text words can be passed instead of the text, for speed.
 */
export function score(query: string | string[], text: string | string[]): number {
  const qs = Array.isArray(query) ? query : words(query);
  const ws = Array.isArray(text) ? text : words(text);
  if (qs.length === 0 || ws.length === 0) return 0;
  let sum = 0;
  for (const q of qs) {
    let best = 0;
    for (const w of ws) {
      const s = wordScore(q, w);
      if (s > best) best = s;
      if (best === 1) break;
    }
    if (best === 0) return 0;
    sum += best;
  }
  return sum / qs.length;
}

/**
 * The best of several fields, each weighted (a name before its keywords):
 * every query word may match in a different field.
 */
export function scoreFields(
  query: string,
  fields: Array<{ text: string; weight: number }>
): number {
  const qs = words(query);
  if (qs.length === 0) return 0;
  const split = fields.map((f) => ({ ws: words(f.text), weight: f.weight }));
  let sum = 0;
  for (const q of qs) {
    let best = 0;
    for (const f of split) {
      for (const w of f.ws) {
        const s = wordScore(q, w) * f.weight;
        if (s > best) best = s;
      }
    }
    if (best === 0) return 0;
    sum += best;
  }
  return sum / qs.length;
}
