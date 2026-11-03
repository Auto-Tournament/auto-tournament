/**
 * The templates the setup game's module ships (CS2: Valve official esports), as the site's own
 * templates are shaped, with negative ids so they never collide with a saved one.
 */
import type { TFunction } from 'i18next';
import { getIntegration } from '../../../integrations/registry';
import type { TournamentSettings, TournamentTemplate } from '../../../types/tournament.types';
import { DEFAULT_SETUP_GAME } from './games';

export function builtInTemplates(t: TFunction): TournamentTemplate[] {
  const shipped =
    getIntegration(DEFAULT_SETUP_GAME.id).tournamentSetup?.builtInTemplates?.(t) ?? [];
  return shipped.map((tpl, i) => {
    // eslint-disable-next-line no-restricted-syntax -- the module's own settings object, the shape a saved template has
    const settings = tpl.settings as unknown as TournamentSettings;
    return {
      id: -(i + 1),
      name: tpl.name,
      description: tpl.description,
      type: tpl.type,
      format: tpl.format,
      facts: tpl.facts,
      maps: [],
      settings,
      createdAt: 0,
      updatedAt: 0,
    };
  });
}
