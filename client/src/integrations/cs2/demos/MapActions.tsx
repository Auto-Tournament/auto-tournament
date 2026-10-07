import type { MatchMapActionProps } from '../../types';
import { DemoAnalysisLink } from './DemoAnalysisLink';
import { MatchReelButton } from './MatchReelButton';

/** A map's CS2 buttons beside its demo download: its match reel and its analysis. */
export function MapActions(props: MatchMapActionProps) {
  return (
    <>
      <MatchReelButton {...props} />
      <DemoAnalysisLink {...props} />
    </>
  );
}
