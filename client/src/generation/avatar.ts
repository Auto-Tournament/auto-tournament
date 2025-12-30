import { createAvatar } from '@dicebear/core';
import { adventurerNeutral } from '@dicebear/collection';

/**
 * Deterministic SVG avatar for client-side rendering, if needed.
 * In most cases the backend should provide avatar URLs, but this is
 * available for purely client-side demo/test data.
 */
export function generateAvatarSvg(seed: string): string {
  return createAvatar(adventurerNeutral, {
    seed,
  }).toString();
}

export function generateAvatarDataUrl(seed: string): string {
  const svg = generateAvatarSvg(seed);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}


