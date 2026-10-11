import { log } from '../../../utils/logger';
import { recoverRecordingLeases } from './recorderLeases';
import { queueMatchReelFor } from './highlights';

let timer: ReturnType<typeof setInterval> | null = null;
let recovering = false;

/** Recover abandoned attempts even when every recorder has disconnected. */
async function recover(): Promise<void> {
  if (recovering) return;
  recovering = true;
  try {
    await queueMatchReelFor(await recoverRecordingLeases());
  } catch (error) {
    log.error('[RECORDER] lease recovery failed', { error });
  } finally {
    recovering = false;
  }
}

export function startRecorderRecovery(): void {
  if (timer) return;
  void recover();
  timer = setInterval(() => void recover(), 60_000);
  timer.unref();
}

export function stopRecorderRecovery(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
