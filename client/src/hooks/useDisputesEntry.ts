/**
 * Whether this instance has a Disputes page worth linking to (3.0 phase D,
 * PR D8).
 *
 * A dispute is only possible where the result is *claimed* by the people who
 * played rather than measured by the game, so it belongs to the module that
 * owns the tournament — CS2 fills the slot with nothing, and the nav item
 * would then point at a page that can never have a row on it.
 *
 * Resolved from the tournament through `useTournamentIntegration` rather than
 * from the instance, which until phase E meant CS2 ("3.0 runs one game per
 * instance"): the whole point of phase D is that the one tournament this
 * instance runs might be Rocket League.
 */

import { useTournamentIntegration } from './useTournamentIntegration';

export function useDisputesEntry(): { show: boolean; loading: boolean } {
  const { integration, loading } = useTournamentIntegration();
  return {
    // Never while it is still loading: a link that appears a beat after the
    // rest of the nav reads as the page glitching.
    show: !loading && Boolean(integration?.adminDisputesView),
    loading,
  };
}
