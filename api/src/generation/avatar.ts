import { createAvatar } from '@dicebear/core';
import { botttsNeutral as avatarCollection } from '@dicebear/collection';

/**
 * Deterministic SVG avatar. Seed SHOULD be stable.
 * Recommendation: seed = playerId, not player name (name can change).
 */
export function generateAvatarSvg(seed: string): string {
  return createAvatar(avatarCollection, {
    seed,
    // You can tune these:
    // backgroundColor: ['0b1020'], // optional: dark esports background
  }).toString();
}

/**
 * Convenience helper to wrap the SVG in a data URL suitable for <img src="...">.
 */
export function generateAvatarDataUrl(seed: string): string {
  const svg = generateAvatarSvg(seed);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
