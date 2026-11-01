/** Which file the highlight player starts on. */

/** A lower quality of a video (the api's VideoCut), highest first. */
export interface VideoCut {
  height: number;
  fps: number;
  url: string;
}

/** Auto: the lightest on a phone (touch, no mouse), the video as made elsewhere. */
export function autoSource(src: string, cuts: VideoCut[]): string {
  const phone =
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const lightest = cuts.at(-1);
  return phone && lightest ? lightest.url : src;
}
