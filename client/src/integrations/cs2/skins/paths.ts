/** The skin pages' URLs (site pages, under core's top bar). */
export const skinPaths = {
  inventory: '/inventory',
  playerInventory: '/player/:steamId/inventory',
} as const;

/** `/player/<steamId>/inventory`. */
export const playerInventoryPath = (steamId: string) => `/player/${encodeURIComponent(steamId)}/inventory`;
