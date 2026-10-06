/**
 * Veto lines in the match's chat (draft 5b): "Veto started · X bans first",
 * each ban, pick and side, and the maps once it is done. Posted through
 * core's `postMatchChatLine` (services/socketService, the bridged module).
 */

import { db } from '../../../config/database';
import { postMatchChatLine } from '../../../services/socketService';

interface VetoLineState {
  status?: string;
  currentTurn?: string;
  currentAction?: string;
  actions?: Array<{ team: string; action: string; mapName?: string; side?: string; timedOut?: boolean }>;
  pickedMaps?: Array<{ mapName: string; mapNumber: number }>;
}

async function teamNames(slug: string): Promise<{ team1: string; team2: string }> {
  const row = await db.queryOneAsync<{ t1: string | null; t2: string | null }>(
    `SELECT t1.name AS t1, t2.name AS t2 FROM matches m
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
      WHERE m.slug = ?`,
    [slug]
  );
  return { team1: row?.t1 ?? 'Team 1', team2: row?.t2 ?? 'Team 2' };
}

/** The line for the veto's latest action, and the summary when it is done. */
export async function postVetoProgress(slug: string, state: VetoLineState): Promise<void> {
  try {
    const last = state.actions?.[state.actions.length - 1];
    if (!last) return;
    const names = await teamNames(slug);
    const team = last.team === 'team1' ? names.team1 : names.team2;
    const key = last.action === 'ban' ? 'vetoBan' : last.action === 'pick' ? 'vetoPick' : 'vetoSide';
    await postMatchChatLine(slug, key, {
      team,
      map: last.mapName ?? '',
      side: last.side ?? '',
      timedOut: last.timedOut === true,
    });
    if (state.status === 'completed') {
      const maps = [...(state.pickedMaps ?? [])].sort((a, b) => a.mapNumber - b.mapNumber).map((m) => m.mapName);
      await postMatchChatLine(slug, 'vetoDone', { maps });
    }
  } catch {
    // A chat line is a courtesy; the veto goes on without it.
  }
}

const announced = new Set<string>();

/** "Veto started · X bans first", once per match. */
export async function postVetoStarted(slug: string, turn: 'team1' | 'team2', action: string): Promise<void> {
  if (announced.has(slug)) return;
  announced.add(slug);
  try {
    const seen = await db.queryOneAsync<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM chat_messages WHERE channel = ? AND body LIKE ?`,
      [`match:${slug}`, 'i18n:{"key":"vetoStarted"%']
    );
    if ((seen?.n ?? 0) > 0) return;
    const names = await teamNames(slug);
    await postMatchChatLine(slug, 'vetoStarted', { team: turn === 'team1' ? names.team1 : names.team2, action });
  } catch {
    // As above.
  }
}
