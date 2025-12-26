// Match-like shape shared across different views (Matches page, Team page, modals).
// We only care about round, team IDs and an optional config with vetoDisabled.
type MatchLike = {
  round?: number | null;
  team1?: { id?: string | null } | null;
  team2?: { id?: string | null } | null;
  config?: {
    vetoDisabled?: boolean;
    team1?: { id?: string | null } | null;
    team2?: { id?: string | null } | null;
    // Allow additional fields without typing them explicitly
    [key: string]: unknown;
  } | null;
  // Allow additional top-level fields without typing them explicitly
  [key: string]: unknown;
};

/**
 * Returns true for manual (non‑bracket) matches created via the manual match modal.
 * These are stored with round = 0 in the DB.
 */
export const isManualMatch = (match: MatchLike | null | undefined): boolean => {
  return !!match && match.round === 0;
};

/**
 * Detects shuffle matches based on team IDs present either on the match object
 * or in the embedded config. Shuffle tournaments use synthetic "shuffle-*"
 * team IDs which we key off here.
 */
export const isShuffleMatch = (match: MatchLike): boolean => {
  return (
    match.team1?.id?.startsWith('shuffle-') ||
    match.team2?.id?.startsWith('shuffle-') ||
    (typeof match.config === 'object' &&
      match.config !== null &&
      'team1' in match.config &&
      (match.config.team1 as { id?: string } | undefined)?.id?.startsWith?.('shuffle-')) ||
    (typeof match.config === 'object' &&
      match.config !== null &&
      'team2' in match.config &&
      (match.config.team2 as { id?: string } | undefined)?.id?.startsWith?.('shuffle-'))
  );
};

/**
 * Frontend-level veto disable flag used by cards, team view and match modal.
 * This is separate from MatchZy's skip_veto flag, which is handled entirely
 * on the server/plugin side.
 */
export const isVetoDisabledForMatch = (match: MatchLike): boolean => {
  return isManualMatch(match) || isShuffleMatch(match) || match.config?.vetoDisabled === true;
};


