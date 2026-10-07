/** Where a clip's kills and slow motion are, in seconds of the video. */
export interface ClipMarkers {
  duration: number;
  kills: number[];
  slowmo: [number, number] | null;
}

/** m:ss */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
