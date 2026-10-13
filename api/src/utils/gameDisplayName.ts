import { db } from '../config/database';
import { getIntegration, hasIntegration } from '../integrations/registry';

/**
 * A game's name for people: the module's own name for a module's game
 * ('cs2' → "Counter-Strike 2"), the catalogue's for a catalogue slug, or the
 * value itself when neither knows it.
 */
export async function gameDisplayName(game: string): Promise<string> {
  if (hasIntegration(game)) return getIntegration(game).displayName;
  const row = await db.queryOneAsync<{ name: string }>('SELECT name FROM games WHERE slug = ?', [
    game,
  ]);
  return row?.name ?? game;
}
