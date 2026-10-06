/**
 * Teams signing themselves up for a tournament, their lineups, and check-in
 * on the day.
 *
 * Teams are universal: one team plays every game. Signing up picks who plays
 * this tournament: up to `teamSize` starters and two subs from the team's
 * roster. The team's owner or a captain signs up, and vouches that every
 * player has read the rules. A signed-up team joins `tournament.team_ids`, so
 * the bracket and everything after it see it like a team an admin added; its
 * matches use the lineup instead of the whole roster (`lineupRoster`).
 *
 * The windows come from the tournament settings: `registrationOpen`,
 * `registrationClosesAt`, `maxTeams`, `checkInOpensAt` and `checkInClosesAt`.
 */

import { db } from '../config/database';
import { emitTournamentUpdate } from './socketService';
import { builtinGames } from './gameCatalogService';
import { teamMembers } from './teamMembers';

export const MAX_SUBS = 2;

export class SignupError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string
  ) {
    super(message);
  }
}

export interface SignupWindow {
  registrationOpen: boolean;
  registrationClosesAt: string | null;
  maxTeams: number | null;
  checkInOpensAt: string | null;
  checkInClosesAt: string | null;
}

/** Something a lineup player still has to fix before the day. */
export type ReadinessProblem = 'noAccount' | 'noGame';

export interface LineupPlayer {
  steamId: string;
  name: string;
  avatar: string | null;
  role: 'starter' | 'sub';
  rating: number | null;
  problems: ReadinessProblem[];
  checkedInAt: number | null;
}

export interface Registration {
  teamId: string;
  teamName: string;
  teamTag: string | null;
  logoUrl: string | null;
  registeredAt: number;
  /** Average rating of the starters, for the ladder. */
  rating: number | null;
  lineup: LineupPlayer[];
}

interface TournamentRow {
  id: number;
  status: string;
  game: string | null;
  team_ids: string;
  team_size: number | null;
  settings: string | null;
}

interface RosterEntry {
  steamId?: string;
  steamid?: string;
  name?: string;
  avatar?: string;
}

function parse<T>(raw: string | null | undefined, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function windowOf(row: TournamentRow): SignupWindow {
  const s = parse<Record<string, unknown>>(row.settings, {});
  const iso = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  return {
    registrationOpen: s.registrationOpen === true,
    registrationClosesAt: iso(s.registrationClosesAt),
    maxTeams: typeof s.maxTeams === 'number' && s.maxTeams > 0 ? s.maxTeams : null,
    checkInOpensAt: iso(s.checkInOpensAt),
    checkInClosesAt: iso(s.checkInClosesAt),
  };
}

function isPast(iso: string | null, now = Date.now()): boolean {
  return Boolean(iso) && new Date(iso as string).getTime() <= now;
}

async function loadTournament(tournamentId: number): Promise<TournamentRow> {
  const row = await db.queryOneAsync<TournamentRow>(
    'SELECT id, status, game, team_ids, team_size, settings FROM tournament WHERE id = ?',
    [tournamentId]
  );
  if (!row) throw new SignupError(404, 'There is no tournament.');
  return row;
}

/** The catalogue game row behind `tournament.game` ('cs2' → counter-strike-2). */
async function gameRowId(game: string | null): Promise<number | null> {
  const ref = game || 'cs2';
  const builtin = builtinGames().find((g) => g.integrationId === ref || g.slug === ref);
  const slug = builtin?.slug ?? ref;
  const row = await db.queryOneAsync<{ id: number }>('SELECT id FROM games WHERE slug = ?', [slug]);
  return row?.id ?? null;
}

async function teamRow(teamId: string) {
  const team = await db.queryOneAsync<{
    id: string;
    name: string;
    tag: string | null;
    players: string;
    owner_uid: string | null;
    logo_updated_at: number | null;
  }>('SELECT id, name, tag, players, owner_uid, logo_updated_at FROM teams WHERE id = ?', [teamId]);
  if (!team) throw new SignupError(404, 'That team does not exist.');
  return team;
}

function rosterSteamIds(players: string): RosterEntry[] {
  return parse<RosterEntry[]>(players, []).filter((p) => p.steamId || p.steamid);
}

/** Owner or captain of the team, or a 403. */
async function requireCaptain(teamId: string, uid: string): Promise<void> {
  const team = await teamRow(teamId);
  if (team.owner_uid === uid) return;
  if ((await teamMembers.roleFor(teamId, uid)) === 'captain') return;
  throw new SignupError(403, 'Only the team owner or a captain can sign the team up.', 'not_captain');
}

/** Rejects a lineup that is not the team's own players, or has the wrong size. */
function validateLineup(
  roster: RosterEntry[],
  starters: string[],
  subs: string[],
  teamSize: number
): void {
  const ids = new Set(roster.map((p) => (p.steamId ?? p.steamid) as string));
  const all = [...starters, ...subs];
  if (new Set(all).size !== all.length) throw new SignupError(400, 'A player is in the lineup twice.');
  if (all.some((id) => !ids.has(id))) {
    throw new SignupError(400, 'Every player in the lineup must be on the team.');
  }
  if (starters.length !== teamSize) {
    throw new SignupError(400, `Pick ${teamSize} starters.`, 'starter_count');
  }
  if (subs.length > MAX_SUBS) throw new SignupError(400, `At most ${MAX_SUBS} subs.`, 'sub_count');
}

async function writeLineup(tournamentId: number, teamId: string, starters: string[], subs: string[]) {
  await db.runAsync('DELETE FROM tournament_lineups WHERE tournament_id = ? AND team_id = ?', [
    tournamentId,
    teamId,
  ]);
  for (const [role, ids] of [
    ['starter', starters],
    ['sub', subs],
  ] as const) {
    for (const steamId of ids) {
      await db.runAsync(
        'INSERT INTO tournament_lineups (tournament_id, team_id, player_id, role) VALUES (?, ?, ?, ?)',
        [tournamentId, teamId, steamId, role]
      );
    }
  }
}

async function setTeamIds(tournamentId: number, teamIds: string[]): Promise<void> {
  await db.runAsync(
    'UPDATE tournament SET team_ids = ?, updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE id = ?',
    [JSON.stringify(teamIds), tournamentId]
  );
  // Draw the bracket again with the teams now in. A count the format cannot
  // draw yet (3 of 4) leaves no bracket until it can.
  const { tournamentService } = await import('./tournamentService');
  try {
    await tournamentService.regenerateBracket(tournamentId, true);
  } catch {
    await db.runAsync("DELETE FROM matches WHERE tournament_id = ? AND status = 'pending'", [tournamentId]);
  }
  emitTournamentUpdate({ id: tournamentId, action: 'tournament_updated' });
}

export const tournamentSignupService = {
  windowOf,

  async window(tournamentId: number): Promise<SignupWindow> {
    return windowOf(await loadTournament(tournamentId));
  },

  /** Every signed-up team with its lineup, readiness and check-in. */
  async registrations(tournamentId: number): Promise<Registration[]> {
    const tournament = await loadTournament(tournamentId);
    const gameId = await gameRowId(tournament.game);
    const rows = await db.queryAsync<{
      team_id: string;
      name: string;
      tag: string | null;
      logo_updated_at: number | null;
      created_at: number;
    }>(
      `SELECT r.team_id, t.name, t.tag, t.logo_updated_at, r.created_at
         FROM tournament_registrations r JOIN teams t ON t.id = r.team_id
        WHERE r.tournament_id = ? ORDER BY r.created_at`,
      [tournamentId]
    );
    const lineupRows = await db.queryAsync<{
      team_id: string;
      player_id: string;
      role: 'starter' | 'sub';
      name: string | null;
      avatar_url: string | null;
      current_elo: number | null;
      uid: string | null;
      has_game: boolean | null;
      checked_in_at: number | null;
    }>(
      `SELECT l.team_id, l.player_id, l.role, p.name, p.avatar_url, p.current_elo, p.uid,
              (pg.player_uid IS NOT NULL) AS has_game, c.checked_in_at
         FROM tournament_lineups l
         LEFT JOIN players p ON p.id = l.player_id
         LEFT JOIN player_games pg ON pg.player_uid = p.uid AND pg.game_id = ?
         LEFT JOIN tournament_checkins c ON c.tournament_id = l.tournament_id AND c.player_id = l.player_id
        WHERE l.tournament_id = ?
        ORDER BY l.role DESC, l.created_at`,
      [gameId ?? -1, tournamentId]
    );
    const rosterNames = new Map<string, string>();
    for (const row of rows) {
      const team = await teamRow(row.team_id);
      for (const p of rosterSteamIds(team.players)) {
        rosterNames.set((p.steamId ?? p.steamid) as string, p.name ?? '');
      }
    }

    // Teams an admin added play with their whole roster: the first team-size
    // players as starters, the rest as subs.
    const teamSize = tournament.team_size ?? 5;
    const registered = new Set(rows.map((r) => r.team_id));
    for (const teamId of parse<string[]>(tournament.team_ids, [])) {
      if (registered.has(teamId)) continue;
      const team = await teamRow(teamId).catch(() => null);
      if (!team) continue;
      rows.push({ team_id: team.id, name: team.name, tag: team.tag, logo_updated_at: team.logo_updated_at, created_at: 0 });
      const roster = rosterSteamIds(team.players);
      const steamIds = roster.map((p) => (p.steamId ?? p.steamid) as string);
      const extra = steamIds.length
        ? await db.queryAsync<{
            id: string;
            name: string;
            avatar_url: string | null;
            current_elo: number;
            uid: string;
            has_game: boolean;
            checked_in_at: number | null;
          }>(
            `SELECT p.id, p.name, p.avatar_url, p.current_elo, p.uid, (pg.player_uid IS NOT NULL) AS has_game, c.checked_in_at
               FROM players p
               LEFT JOIN player_games pg ON pg.player_uid = p.uid AND pg.game_id = ?
               LEFT JOIN tournament_checkins c ON c.tournament_id = ? AND c.player_id = p.id
              WHERE p.id = ANY(?::text[])`,
            [gameId ?? -1, tournamentId, steamIds]
          )
        : [];
      const byId = new Map(extra.map((p) => [p.id, p]));
      roster.forEach((p, index) => {
        const steamId = (p.steamId ?? p.steamid) as string;
        const player = byId.get(steamId);
        rosterNames.set(steamId, p.name ?? '');
        lineupRows.push({
          team_id: team.id,
          player_id: steamId,
          role: index < teamSize ? 'starter' : 'sub',
          name: player?.name ?? p.name ?? null,
          avatar_url: player?.avatar_url ?? null,
          current_elo: player?.current_elo ?? null,
          uid: player?.uid ?? null,
          has_game: player?.has_game ?? null,
          checked_in_at: player?.checked_in_at ?? null,
        });
      });
    }

    return rows.map((row) => {
      const lineup: LineupPlayer[] = lineupRows
        .filter((l) => l.team_id === row.team_id)
        .map((l) => {
          const problems: ReadinessProblem[] = [];
          if (!l.uid) problems.push('noAccount');
          else if (gameId !== null && !l.has_game) problems.push('noGame');
          return {
            steamId: l.player_id,
            name: l.name ?? rosterNames.get(l.player_id) ?? l.player_id,
            avatar: l.avatar_url,
            role: l.role,
            rating: l.current_elo,
            problems,
            checkedInAt: l.checked_in_at,
          };
        });
      const starters = lineup.filter((p) => p.role === 'starter' && p.rating !== null);
      return {
        teamId: row.team_id,
        teamName: row.name,
        teamTag: row.tag,
        logoUrl: row.logo_updated_at
          ? `/api/team-directory/${encodeURIComponent(row.team_id)}/logo?v=${row.logo_updated_at}`
          : null,
        registeredAt: row.created_at,
        rating: starters.length
          ? Math.round(starters.reduce((sum, p) => sum + (p.rating ?? 0), 0) / starters.length)
          : null,
        lineup,
      };
    });
  },

  /** Teams the account may sign up (owner or captain), with their rosters. */
  async eligibleTeams(uid: string) {
    const memberships = await teamMembers.listForAccount(uid);
    const captainOf = memberships.filter((m) => m.role === 'captain').map((m) => m.teamId);
    const owned = await db.queryAsync<{ id: string }>('SELECT id FROM teams WHERE owner_uid = ?', [uid]);
    const ids = [...new Set([...owned.map((t) => t.id), ...captainOf])];
    const teams = [];
    for (const id of ids) {
      const team = await teamRow(id);
      const roster = rosterSteamIds(team.players);
      const steamIds = roster.map((p) => (p.steamId ?? p.steamid) as string);
      const players = steamIds.length
        ? await db.queryAsync<{ id: string; name: string; avatar_url: string | null; current_elo: number }>(
            'SELECT id, name, avatar_url, current_elo FROM players WHERE id = ANY(?::text[])',
            [steamIds]
          )
        : [];
      const byId = new Map(players.map((p) => [p.id, p]));
      teams.push({
        id: team.id,
        name: team.name,
        tag: team.tag,
        role: team.owner_uid === uid ? 'owner' : 'captain',
        members: roster.map((p) => {
          const steamId = (p.steamId ?? p.steamid) as string;
          const player = byId.get(steamId);
          return {
            steamId,
            name: player?.name ?? p.name ?? steamId,
            avatar: player?.avatar_url ?? p.avatar ?? null,
            rating: player?.current_elo ?? null,
            hasAccount: Boolean(player),
          };
        }),
      });
    }
    return teams;
  },

  async register(
    tournamentId: number,
    uid: string,
    input: { teamId: string; starters: string[]; subs: string[]; acceptRules: boolean }
  ): Promise<void> {
    const tournament = await loadTournament(tournamentId);
    const win = windowOf(tournament);
    if (tournament.status !== 'setup') throw new SignupError(409, 'The tournament has started.', 'started');
    if (!win.registrationOpen) throw new SignupError(409, 'Sign-up is not open.', 'closed');
    if (isPast(win.registrationClosesAt)) throw new SignupError(409, 'Sign-up has closed.', 'closed');
    if (!input.acceptRules) {
      throw new SignupError(400, 'Confirm that every player has read the rules.', 'rules');
    }
    await requireCaptain(input.teamId, uid);

    const teamIds = parse<string[]>(tournament.team_ids, []);
    if (teamIds.includes(input.teamId)) throw new SignupError(409, 'The team is already in.', 'already_in');
    if (win.maxTeams !== null && teamIds.length >= win.maxTeams) {
      throw new SignupError(409, 'Every team spot is taken.', 'full');
    }

    const team = await teamRow(input.teamId);
    validateLineup(rosterSteamIds(team.players), input.starters, input.subs, tournament.team_size ?? 5);

    await db.runAsync(
      `INSERT INTO tournament_registrations (tournament_id, team_id, registered_by_uid, rules_accepted_at)
       VALUES (?, ?, ?, EXTRACT(EPOCH FROM NOW())::INTEGER)`,
      [tournamentId, input.teamId, uid]
    );
    await writeLineup(tournamentId, input.teamId, input.starters, input.subs);
    await setTeamIds(tournamentId, [...teamIds, input.teamId]);
  },

  async changeLineup(
    tournamentId: number,
    uid: string,
    input: { teamId: string; starters: string[]; subs: string[] }
  ): Promise<void> {
    const tournament = await loadTournament(tournamentId);
    const win = windowOf(tournament);
    if (tournament.status === 'completed') throw new SignupError(409, 'The tournament is over.');
    if (isPast(win.checkInClosesAt)) {
      throw new SignupError(409, 'The lineup is locked once check-in closes.', 'locked');
    }
    await requireCaptain(input.teamId, uid);
    const registered = await db.queryOneAsync(
      'SELECT team_id FROM tournament_registrations WHERE tournament_id = ? AND team_id = ?',
      [tournamentId, input.teamId]
    );
    if (!registered) throw new SignupError(404, 'The team is not signed up.');
    const team = await teamRow(input.teamId);
    validateLineup(rosterSteamIds(team.players), input.starters, input.subs, tournament.team_size ?? 5);
    await writeLineup(tournamentId, input.teamId, input.starters, input.subs);
    emitTournamentUpdate({ id: tournamentId, action: 'tournament_updated' });
  },

  async withdraw(tournamentId: number, uid: string, teamId: string): Promise<void> {
    const tournament = await loadTournament(tournamentId);
    if (tournament.status !== 'setup') {
      throw new SignupError(409, 'A team cannot withdraw once the tournament has started.', 'started');
    }
    await requireCaptain(teamId, uid);
    await db.runAsync('DELETE FROM tournament_registrations WHERE tournament_id = ? AND team_id = ?', [
      tournamentId,
      teamId,
    ]);
    await db.runAsync('DELETE FROM tournament_lineups WHERE tournament_id = ? AND team_id = ?', [
      tournamentId,
      teamId,
    ]);
    await db.runAsync('DELETE FROM tournament_checkins WHERE tournament_id = ? AND team_id = ?', [
      tournamentId,
      teamId,
    ]);
    const teamIds = parse<string[]>(tournament.team_ids, []).filter((id) => id !== teamId);
    await setTeamIds(tournamentId, teamIds);
  },

  /** A lineup player says "I'm here" inside the check-in window. */
  async checkIn(tournamentId: number, steamId: string): Promise<void> {
    const tournament = await loadTournament(tournamentId);
    const win = windowOf(tournament);
    if (!win.checkInOpensAt || !isPast(win.checkInOpensAt)) {
      throw new SignupError(409, 'Check-in is not open yet.', 'not_open');
    }
    if (isPast(win.checkInClosesAt)) throw new SignupError(409, 'Check-in has closed.', 'closed');
    let slot = await db.queryOneAsync<{ team_id: string }>(
      'SELECT team_id FROM tournament_lineups WHERE tournament_id = ? AND player_id = ?',
      [tournamentId, steamId]
    );
    if (!slot) {
      // A team an admin added has no lineup: its roster checks in.
      for (const teamId of parse<string[]>(tournament.team_ids, [])) {
        const team = await teamRow(teamId).catch(() => null);
        if (team && rosterSteamIds(team.players).some((p) => (p.steamId ?? p.steamid) === steamId)) {
          slot = { team_id: teamId };
          break;
        }
      }
    }
    if (!slot) throw new SignupError(403, 'You are not in a lineup in this tournament.', 'not_in_lineup');
    await db.runAsync(
      `INSERT INTO tournament_checkins (tournament_id, team_id, player_id) VALUES (?, ?, ?)
       ON CONFLICT (tournament_id, player_id) DO NOTHING`,
      [tournamentId, slot.team_id, steamId]
    );
    emitTournamentUpdate({ id: tournamentId, action: 'tournament_updated' });
  },

  /**
   * The roster a match uses for a team: its lineup in this tournament
   * (starters, then subs) when it signed up with one, the whole roster
   * otherwise.
   */
  async lineupRoster(tournamentId: number, teamId: string, rosterJson: string): Promise<string> {
    const lineup = await db
      .queryAsync<{ player_id: string }>(
        `SELECT player_id FROM tournament_lineups WHERE tournament_id = ? AND team_id = ?
          ORDER BY CASE role WHEN 'starter' THEN 0 ELSE 1 END, created_at`,
        [tournamentId, teamId]
      )
      .catch(() => []);
    if (lineup.length === 0) return rosterJson;
    const wanted = new Set(lineup.map((l) => l.player_id));
    const roster = parse<RosterEntry[]>(rosterJson, []);
    return JSON.stringify(roster.filter((p) => wanted.has((p.steamId ?? p.steamid) as string)));
  },
};
