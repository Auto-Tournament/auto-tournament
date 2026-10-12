/**
 * A comment's text in pieces: plain text, and `mm:ss` / `h:mm:ss` times that
 * seek the video (like YouTube). Only real times are links: seconds and (with
 * hours) minutes under 60, and within the video when its length is known.
 * Other numbers stay text.
 */

export type CommentPiece = { text: string } | { text: string; at: number };

const TIME = /(?<![\d:])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?![\d:])/g;

export function commentPieces(body: string, duration: number | null): CommentPiece[] {
  const out: CommentPiece[] = [];
  let last = 0;
  for (const m of body.matchAll(TIME)) {
    const [whole, h, mm, ss] = m;
    const hours = h === undefined ? 0 : Number(h);
    const minutes = Number(mm);
    const seconds = Number(ss);
    if (seconds >= 60 || (h !== undefined && minutes >= 60)) continue;
    const at = hours * 3600 + minutes * 60 + seconds;
    if (duration !== null && at > duration + 0.5) continue;
    if (m.index! > last) out.push({ text: body.slice(last, m.index) });
    out.push({ text: whole, at });
    last = m.index! + whole.length;
  }
  if (last < body.length) out.push({ text: body.slice(last) });
  return out;
}
