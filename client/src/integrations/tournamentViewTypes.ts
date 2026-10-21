import type { Untrusted } from '../utils/untrusted';

/** A game module's rules summary (`GameIntegration.tournamentRulesView`). */
/** Manage's Prizes tab (`GameIntegration.tournamentPrizesManage`). */
export interface TournamentPrizesManageProps {
  tournament: { id: number; name: string; status: string; settings?: Untrusted };
  /** Saves a patch of the tournament's settings (merged into them by the API). */
  onSave: (settingsPatch: Record<string, Untrusted>) => Promise<void>;
}

/** A game module's prizes view (`GameIntegration.tournamentPrizesView`). */
export interface TournamentPrizesViewProps {
  tournament: { id: number; status: string; settings?: Untrusted };
}

export interface TournamentRulesViewProps {
  tournament: {
    type: string;
    format: string;
    teamSize?: number | null;
    settings?: Untrusted;
  };
  /** One line for the overview instead of the list. */
  compact?: boolean;
}
