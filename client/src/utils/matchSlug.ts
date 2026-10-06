/**
 * Match slugs without their tournament prefix. A tournament after the first
 * carries its id in its slugs (`t2-r1m1`, `t2-gf`; api/src/utils/matchSlug.ts),
 * so anything that reads a slug's meaning strips it first.
 */
export function bareSlug(slug: string | null | undefined): string {
  return (slug ?? '').replace(/^t\d+-/, '');
}

export const isGrandFinalSlug = (slug: string | null | undefined): boolean => bareSlug(slug) === 'gf';

export const isLosersBracketSlug = (slug: string | null | undefined): boolean => bareSlug(slug).startsWith('lb-');
