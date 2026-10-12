import { NewSkinReveal } from '../skins/NewSkinReveal';
import { MatchCrashDialog } from '../match/MatchCrashDialog';

/** This module's `globalOverlay`: the new-skin reveal and the "your server crashed" popup. */
export function Cs2Overlays() {
  return (
    <>
      <NewSkinReveal />
      <MatchCrashDialog />
    </>
  );
}
