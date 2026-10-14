import { NewSkinReveal } from '../skins/NewSkinReveal';
import { MatchCrashDialog } from '../match/MatchCrashDialog';
import { MatchDroppedDialog } from '../match/MatchDroppedDialog';

/** This module's `globalOverlay`: the new-skin reveal, "your server crashed" and "you lost connection". */
export function Cs2Overlays() {
  return (
    <>
      <NewSkinReveal />
      <MatchCrashDialog />
      <MatchDroppedDialog />
    </>
  );
}
