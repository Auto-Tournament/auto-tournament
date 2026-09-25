/**
 * The sound an admin hears when a player calls for one.
 *
 * Muting is per browser (localStorage), separate from the team page's alert
 * settings: an admin may want one and not the other. Storage can be missing
 * or refuse (private mode): the sound is then on, and a mute lasts the visit.
 *
 * Browsers refuse to play audio before the person has interacted with the
 * page. `play()` then resolves to `'blocked'`, and the caller offers a button
 * (a click is the interaction that lets the next sound through).
 */

const MUTED_KEY = 'mat.adminCalls.soundMuted';
const SOUND_URL = '/alerts/notification-bell-sound-1-376885.mp3';
const VOLUME = 0.6;

let memoryMuted: boolean | null = null;

export function isAdminCallSoundMuted(): boolean {
  if (memoryMuted !== null) return memoryMuted;
  try {
    return window.localStorage.getItem(MUTED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setAdminCallSoundMuted(muted: boolean): void {
  memoryMuted = muted;
  try {
    window.localStorage.setItem(MUTED_KEY, muted ? 'true' : 'false');
  } catch {
    // Kept in memory for this visit.
  }
}

export type AdminCallSoundResult = 'played' | 'muted' | 'blocked' | 'failed';

/** Play the call sound once, unless muted. */
export async function playAdminCallSound(
  options: { ignoreMute?: boolean } = {}
): Promise<AdminCallSoundResult> {
  if (!options.ignoreMute && isAdminCallSoundMuted()) return 'muted';
  try {
    const audio = new Audio(SOUND_URL);
    audio.volume = VOLUME;
    await audio.play();
    return 'played';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') return 'blocked';
    console.warn('Could not play the admin call sound:', error);
    return 'failed';
  }
}
