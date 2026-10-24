/** Which file the highlight player plays for a quality pick (QualityMenu.tsx). */

/** A lower quality of a video (the api's VideoCut), highest first. */
export interface VideoCut {
  height: number;
  fps: number;
  url: string;
}

/** 'auto', 'highest' (the video as made) or a cut's url. */
export type QualityPick = string;

/** Auto: the lightest on a phone (touch, no mouse), the video as made elsewhere. */
export function autoSource(src: string, cuts: VideoCut[]): string {
  const phone =
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const lightest = cuts.at(-1);
  return phone && lightest ? lightest.url : src;
}

/** The url the player plays for a pick. */
export function sourceFor(pick: QualityPick, src: string, cuts: VideoCut[]): string {
  if (pick === 'auto') return autoSource(src, cuts);
  if (pick === 'highest') return src;
  return cuts.some((c) => c.url === pick) ? pick : src;
}
