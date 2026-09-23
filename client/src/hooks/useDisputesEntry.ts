/**
 * Whether this instance has a Disputes page worth linking to (3.0 phase D,
 * PR D8).
 *
 * A dispute is only possible where the result is *claimed* by the people who
 * played rather than measured by the game, so it belongs to the module that
 * owns the tournament — CS2 fills the slot with nothing, and the nav item
 * would then point at a page that can never have a row on it.
 *
 * Resolved from the tournament rather than from `instanceIntegration()`, which
 * is hard-wired to CS2 ("3.0 runs one game per instance"): the whole point of
 * phase D is that the one tournament this instance runs might be Rocket
 * League. `useTournamentStatus` is the same read `TeamMatch` already uses for
 * the same decision.
 */

import { useTournamentStatus } from './useTournamentStatus';
import { integrationFor } from '../integrations/registry';

export function useDisputesEntry(): { show: boolean; loading: boolean } {
  const { tournament, loading } = useTournamentStatus();
  return {
    // Never while it is still loading: a link that appears a beat after the
    // rest of the nav reads as the page glitching.
    show: !loading && Boolean(integrationFor(tournament).adminDisputesView),
    loading,
  };
}
