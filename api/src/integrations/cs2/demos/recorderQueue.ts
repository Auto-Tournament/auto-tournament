import { db } from '../../../config/database';
import { waitingTournamentReels } from './highlightViews';
import { anyRecorderTargetFilter } from './recorderFleet';
import { recordingWaiting } from './recorderLeases';
import { waitingRedressJobs } from './redress';

/**
 * How many claims a newly started recorder could get now, for a host that scales
 * recorders. Read only: a claim's own clean-up does not run. No name is asked, so
 * a retry reserved for the recorder that failed it waits out its reservation here
 * (recordingWaiting's `recorder = ''` never matches).
 */
export async function waitingRecorderJobs(): Promise<number> {
  const row = await db.queryOneAsync<{ n: number | string }>(
    `SELECT (SELECT COUNT(*) FROM (
               SELECT DISTINCT match_slug, map_number, player_id FROM cs2_highlights h
                WHERE ${recordingWaiting('h')} AND ${anyRecorderTargetFilter('h.match_slug')}
                  AND EXISTS (SELECT 1 FROM matches m WHERE m.slug = h.match_slug)) players)
          + (SELECT COUNT(*) FROM cs2_match_reels
              WHERE ${recordingWaiting()} AND ${anyRecorderTargetFilter('cs2_match_reels.match_slug')})
          + (SELECT COUNT(*) FROM cs2_team_reels
              WHERE ${recordingWaiting()} AND ${anyRecorderTargetFilter('cs2_team_reels.match_slug')}) AS n`,
    ['', '', '']
  );
  return Number(row?.n ?? 0) + (await waitingTournamentReels()) + (await waitingRedressJobs());
}
