/** Drop odds as text (its own file: no client imports, so tests can load it). */

/** A percent for people: "12.5 %", "0.031 %", "< 0.001 %", "0 %". */
export function formatOdds(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return '0 %';
  if (pct < 0.001) return '< 0.001 %';
  const digits = pct >= 10 ? 1 : pct >= 1 ? 2 : Math.min(3, 2 - Math.floor(Math.log10(pct)));
  return `${Number(pct.toFixed(digits))} %`;
}
