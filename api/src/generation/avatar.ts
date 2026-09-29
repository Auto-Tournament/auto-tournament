/**
 * Deterministic placeholder avatar: a person silhouette on a colour picked
 * from the seed. Drawn here (no third-party artwork), so there is nothing to
 * license or attribute. Seed SHOULD be stable, e.g. the player id.
 */
const PALETTE = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16'];

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function generateAvatarSvg(seed: string): string {
  const bg = PALETTE[hash(seed || 'player') % PALETTE.length];
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">' +
    `<rect width="64" height="64" fill="${bg}"/>` +
    '<circle cx="32" cy="25" r="11" fill="#ffffff" fill-opacity="0.9"/>' +
    '<path d="M12 58c2-11 10-17 20-17s18 6 20 17z" fill="#ffffff" fill-opacity="0.9"/>' +
    '</svg>'
  );
}

/** The SVG as a data URL for <img src="...">. */
export function generateAvatarDataUrl(seed: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(generateAvatarSvg(seed))}`;
}
