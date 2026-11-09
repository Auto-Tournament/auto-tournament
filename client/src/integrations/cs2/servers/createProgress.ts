/**
 * csm's progress while it creates the first servers on a machine, as the Servers page shows
 * it. csm reports English steps: bootstrap's "[n/m]" step names, with SteamCMD's download
 * inside the CS2 step ("Installing/updating master CS2 installation: downloading 74 % (31.5
 * of 42.2 GB)"), then "installing Ready Up on the new servers" and "starting server-1".
 */

export type CreatePhase =
  'waiting' | 'prepare' | 'download' | 'check' | 'install' | 'setup' | 'readyup' | 'start';

export interface CreateProgress {
  /** Null for a step this page doesn't know: show csm's own words. */
  phase: CreatePhase | null;
  /** 1 to CREATE_STAGES. */
  stage: number | null;
  /** SteamCMD's percent of the download or check, when it reports one. */
  pct: number | null;
  doneGb: number | null;
  totalGb: number | null;
}

export const CREATE_STAGES = 4;

const STEAM = /:\s*([a-z ]+?)\s+(\d+)\s*%(?:\s*\(([\d.]+) of ([\d.]+) GB\))?\s*$/;

const STAGE: Record<CreatePhase, number> = {
  prepare: 1,
  waiting: 2,
  download: 2,
  check: 2,
  install: 2,
  setup: 2,
  readyup: 3,
  start: 4,
};

function phaseOf(name: string, state: string): CreatePhase | null {
  if (name.startsWith('waiting for the cs2 download')) return 'waiting';
  if (name.includes('cs2 user')) return 'prepare';
  if (name.includes('master cs2')) {
    if (state.startsWith('verifying')) return 'check';
    if (state.startsWith('downloading')) return 'download';
    return 'install';
  }
  if (
    name.includes('steam sdk') ||
    name.includes('shared configuration') ||
    name.startsWith('setting up server-')
  )
    return 'setup';
  if (name.includes('ready up')) return 'readyup';
  if (name.startsWith('starting server-')) return 'start';
  return null;
}

export function createProgress(step: string | null): CreateProgress {
  const none = { phase: null, stage: null, pct: null, doneGb: null, totalGb: null };
  if (!step) return none;
  const m = STEAM.exec(step);
  const name = (m ? step.slice(0, m.index) : step).trim().toLowerCase();
  const phase = phaseOf(name, m?.[1] ?? '');
  if (!phase) return none;
  return {
    phase,
    stage: STAGE[phase],
    pct: m ? Number(m[2]) : null,
    doneGb: m?.[3] ? Number(m[3]) : null,
    totalGb: m?.[4] ? Number(m[4]) : null,
  };
}
