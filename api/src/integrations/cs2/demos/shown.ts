/**
 * What viewers see of a clip or a reel: a done one, and one being made again
 * that still has its old video (a redo keeps showing it until the new one
 * replaces it). A dropped clip ('skipped') is never shown.
 */
export const isShown = (status: string, clipPath: string | null | undefined): boolean =>
  status === 'done' || (!!clipPath && status !== 'skipped');

/** isShown in SQL, for the row alias `a`. */
export const shownSql = (a: string): string =>
  `(${a}.status = 'done' OR (${a}.status <> 'skipped' AND ${a}.clip_path IS NOT NULL))`;
