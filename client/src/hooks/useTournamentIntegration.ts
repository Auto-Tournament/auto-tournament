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
 * With no tournament — a fresh install, mid-setup — the answer is *no module*,
 * not CS2's. PR #311 fell back to CS2 there, on the grounds that it is the
 * game every install has had, and the result was that a brand new instance was
 * told to configure a webhook URL for a game it had not said it was running
 * yet. An instance with nothing to run has nothing that needs fixing before it
 * can run, so the shell says nothing until there is a tournament to say it
 * about.
 */

import { useTournamentStatus } from './useTournamentStatus';
import { integrationFor } from '../integrations/registry';
import type { ClientGameIntegration } from '../integrations/types';

export function useTournamentIntegration(): {
  /** Null while the tournament is loading, and when there is no tournament. */
  integration: ClientGameIntegration | null;
  loading: boolean;
} {
  const { tournament, loading } = useTournamentStatus();
  return { integration: tournament ? integrationFor(tournament) : null, loading };
}
