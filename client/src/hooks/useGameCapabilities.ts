/**
 * What the game this instance is running gives the pages that are not about
 * one tournament — a player's profile, the match list (3.0 phase D, PR D10).
 *
 * Those pages show kills, deaths, ADR, headshots and a demo link, which are
 * things a *game* measured. A game that measures nothing has no zero to show;
 * it has nothing to show, and a column of "N/A" says the data is missing when
 * the truth is that it was never going to exist.
 *
 * Resolved from the tournament rather than from `instanceIntegration()`, which
 * is hard-wired to CS2 ("3.0 runs one game per instance"): the whole point of
 * phase D is that the one tournament this instance runs might be Rocket
 * League. Same read `useDisputesEntry` makes for the same kind of decision.
 *
 * While it loads, and with no tournament at all, the answer is CS2's — the
 * game every instance has had — so nothing flickers away on the common path.
 */

import { useTournamentStatus } from './useTournamentStatus';
import { integrationFor } from '../integrations/registry';
import type { GameCapabilities } from '../integrations/types';

export function useGameCapabilities(): { capabilities: GameCapabilities; loading: boolean } {
  const { tournament, loading } = useTournamentStatus();
  return { capabilities: integrationFor(tournament).capabilities, loading };
}
