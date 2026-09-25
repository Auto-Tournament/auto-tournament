/** Up to three characters standing in for a missing cover: "Counter-Strike 2" -> "CS2". */
export function gameMonogram(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .split(/[\s-]+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => (/^\d+$/.test(w) ? w : w[0]))
    .join('')
    .slice(0, 3)
    .toUpperCase();
}
