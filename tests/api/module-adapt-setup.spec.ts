import { test, expect } from '@playwright/test';
import { adaptCodeModule } from '../../client/src/module-loader/adapt';
import type { ClientGameIntegration } from '../../client/src/integrations/types';

/** A code module's setup model reaches the app whole (client/src/module-loader/adapt.tsx). */
test('the adapter keeps every setup function, built-in templates included', () => {
  const tpl = { key: 'k', name: 'K', type: 'single_elimination', format: 'bo3', settings: {} };
  const adapted = adaptCodeModule({
    id: 'x',
    routes: [],
    navItems: [],
    tournamentSetup: { builtInTemplates: () => [tpl], minutesPerMap: () => 42 },
  } as unknown as ClientGameIntegration);
  const t = ((k: string) => k) as never;
  expect(adapted.tournamentSetup?.builtInTemplates?.(t)).toEqual([tpl]);
  expect(adapted.tournamentSetup?.minutesPerMap?.({}, {} as never)).toBe(42);
});
