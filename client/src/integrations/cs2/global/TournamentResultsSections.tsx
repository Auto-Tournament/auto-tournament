import type { TournamentResultsSectionProps } from '../../types';
import { TournamentReelSection } from '../highlights/TournamentHighlights';
import { TournamentPrizeCards } from '../skins/PrizeCards';

/** This module's part of a finished tournament's results: the viewer's prize and the MVP, then the reel and plays. Every player's reward is the footer (TournamentRewardsSection). */
export function TournamentResultsSections(props: TournamentResultsSectionProps) {
  return (
    <>
      <TournamentPrizeCards tournamentId={props.tournamentId} />
      <TournamentReelSection {...props} />
    </>
  );
}
