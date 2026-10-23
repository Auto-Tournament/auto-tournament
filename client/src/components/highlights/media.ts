/** Where a clip's kills and slow motion are, in seconds of the video. */
export interface ClipMarkers {
  duration: number;
  kills: number[];
  slowmo: [number, number] | null;
  /** For each of `kills`, whether it was a headshot (absent: not known). */
  headshots?: boolean[];
  /** The crowd's reactions; `aww` is the player dying. */
  reactions?: { t: number; score: number; aww?: boolean }[];
}

/** m:ss */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
