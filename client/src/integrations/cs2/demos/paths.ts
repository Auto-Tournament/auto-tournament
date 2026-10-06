/** The demo analysis page (a site page, under core's top bar). */
export const demoPaths = {
  analysis: '/analysis/:matchSlug/:mapNumber',
} as const;

/** `/analysis/<match>/<map>`, the map 0-based. */
export const analysisPath = (matchSlug: string, mapNumber: number) =>
  `/analysis/${encodeURIComponent(matchSlug)}/${mapNumber}`;
