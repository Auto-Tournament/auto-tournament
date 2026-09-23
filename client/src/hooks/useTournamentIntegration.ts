/**
 * The integration that owns the tournament this instance is running (3.0
 * phase E).
 *
 * The admin shell and the start button are not about one match, but they are
 * about one tournament, and some of what they say is the module's: a webhook
 * URL matters to a game whose servers call back, and an allocation is
 * something only a game with servers does.
 *
 * Resolved from the tournament rather than from `instanceIntegration()`, which
 * is hard-wired to CS2 ("3.0 runs one game per instance"), for the reason
 * phase D exists: the one tournament this instance runs might be Rocket
 * League. `useTournamentStatus` is the same read `useDisputesEntry` and
 * `TeamMatch` already make for the same decision.
 *
 * With no tournament yet — a fresh install, mid-setup — the answer is CS2's,
 * the game every install has had, so nothing on the common path changes shape
 * while an admin is still deciding what to run.
 */

import { useTournamentStatus } from './useTournamentStatus';
import { integrationFor } from '../integrations/registry';
import type { ClientGameIntegration } from '../integrations/types';

export function useTournamentIntegration(): {
  integration: ClientGameIntegration;
  loading: boolean;
} {
  const { tournament, loading } = useTournamentStatus();
  return { integration: integrationFor(tournament), loading };
}
