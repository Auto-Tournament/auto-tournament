/**
 * How far an Update all has got, for the line under the button on the
 * Recorders tab: the recorders whose update was asked for together (within two
 * minutes of the newest request), how many are on the new version, how many
 * failed and how many are still going. Shown for 30 minutes after the request.
 */
export interface BatchRecorder {
  updateStatus: string;
  updateRequestedAt?: number | null;
}

export interface UpdateBatch {
  total: number;
  done: number;
  failed: number;
  running: number;
}

const TOGETHER_SECONDS = 120;
const SHOWN_SECONDS = 30 * 60;

export function updateBatch(recorders: readonly BatchRecorder[], now: number): UpdateBatch | null {
  const asked = recorders.filter((r) => typeof r.updateRequestedAt === 'number');
  if (asked.length === 0) return null;
  const latest = Math.max(...asked.map((r) => r.updateRequestedAt!));
  if (now - latest > SHOWN_SECONDS) return null;
  const batch = asked.filter((r) => r.updateRequestedAt! >= latest - TOGETHER_SECONDS);
  const count = (statuses: string[]) =>
    batch.filter((r) => statuses.includes(r.updateStatus)).length;
  return {
    total: batch.length,
    done: count(['current']),
    failed: count(['failed']),
    running: count(['queued', 'updating']),
  };
}
