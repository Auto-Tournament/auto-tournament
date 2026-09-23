/**
 * Which module's chrome the admin shell shows (3.0 phase E).
 *
 * The surfaces that are not about one tournament — the sidebar, the manage
 * rail, the admin home's link grid and its resource card, the match list's
 * allocation panel — asked the instance, which meant CS2 ("3.0 runs one game
 * per instance"). So a Rocket League instance still
 * listed Servers and Maps and still showed a CS2 server card on a page that
 * can never have a server on it.
 *
 * They ask this instead. The instance runs exactly one tournament (see
 * `useTournamentList`), so the tournament's module *is* the instance's game,
 * and its chrome is the only chrome that belongs on those pages.
 *
 * Before there is a tournament, every installed module's chrome is shown:
 * nothing has said what this instance runs yet, and the pages an admin
 * configures *before* creating a tournament — CS2's servers and maps — are
 * exactly the ones that would otherwise be unreachable until after the
 * tournament that needs them exists.
 *
 * While the tournament loads, no module's chrome is shown, the same way
 * `useDisputesEntry` holds its link back: an item that appears a beat after
 * the rest of the nav reads as the page glitching.
 */

import { useTournamentIntegration } from './useTournamentIntegration';
import { listIntegrations } from '../integrations/registry';
import type { ClientGameIntegration } from '../integrations/types';

export function useShellIntegrations(): {
  /** The tournament's module; null while loading and with no tournament. */
  tournament: ClientGameIntegration | null;
  /** Whose chrome the shell shows — see above. */
  shell: ClientGameIntegration[];
  loading: boolean;
} {
  const { integration, loading } = useTournamentIntegration();
  return {
    tournament: integration,
    shell: loading ? [] : integration ? [integration] : listIntegrations(),
    loading,
  };
}

/**
 * The module that fills one of the shell's one-of-a-kind slots (the admin
 * home's resource card, the manage grid, the allocation panel, the standalone
 * match steps). With a tournament there is only ever one module to ask;
 * before there is one, the modules are asked in registration order.
 *
 * It answers with the *module*, not the slot, so the caller reads the
 * component off it: a helper that returned the component itself would be
 * creating a component during render, which `react-hooks/static-components`
 * rightly refuses.
 */
export function shellModule(
  shell: ClientGameIntegration[],
  fills: (integration: ClientGameIntegration) => unknown
): ClientGameIntegration | undefined {
  return shell.find((integration) => Boolean(fills(integration)));
}
