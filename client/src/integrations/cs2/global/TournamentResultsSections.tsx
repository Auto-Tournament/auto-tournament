import type { TournamentResultsSectionProps } from '../../types';
import { TournamentReelSection } from '../highlights/TournamentHighlights';
import { TournamentRewardsSection } from '../skins/TournamentRewards';

/** This module's part of a finished tournament's results: the reel and plays, then the top three's rewards. */
export function TournamentResultsSections(props: TournamentResultsSectionProps) {
  return (
    <>
      <TournamentReelSection {...props} />
      <TournamentRewardsSection {...props} />
    </>
  );
}
