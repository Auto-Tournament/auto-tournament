/**
 * What the Ready Up compatibility endpoints and the `compat:update` socket
 * event answer with. The document itself is `CompatDocument`
 * (utils/compatPayload.ts); these add where and when this instance got it.
 */

import type { CompatComponentStatus, CompatDocument } from '../utils/compatPayload';

/** `push`: POST /api/compat/events. `pull`: fetched from COMPAT_FEED_URL. */
export type CompatSource = 'push' | 'pull';

interface ReceivedFields {
  source: CompatSource;
  /** When this instance first stored the run (ISO 8601). */
  received_at: string;
  /** When this instance last changed it (ISO 8601). */
  updated_at: string;
}

/** A run with every component's checks: `GET /api/compat/latest`. */
export type CompatSnapshot = CompatDocument & ReceivedFields;

/** A run with each component's status only: `GET /api/compat/runs`. */
export type CompatRunSummary = Omit<CompatDocument, 'components'> &
  ReceivedFields & {
    components: Array<{ id: string; name: string; status: CompatComponentStatus }>;
  };

/** Socket.IO `compat:update`, sent to the `compat` room on every stored change. */
export interface CompatUpdateEvent {
  /** The newest run now (not necessarily the one that changed). */
  latest: CompatSnapshot | null;
  /** The run that changed. */
  run: CompatRunSummary;
}
