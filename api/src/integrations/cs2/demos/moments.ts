/**
 * Notable moments of a map, for integrators (GET /api/integrations/highlights,
 * ./momentStore.ts): a knife kill, a Zeus kill, an ace, a 1vN clutch, a
 * no-scope, a grenade kill, a defuse in the last second.
 *
 * Facts about a match, not trophies and not clips: an event website reads
 * them and decides what they earn. Picked from what the demo analysis
 * already stores (cs2_demo_jobs.rounds and .kills, ./jobs.ts), plus the 2D
 * replay's frames and bomb events (who was alive, the plant and the defuse).
 *
 * Only real rounds count: the analyzer already leaves warmup out (play
 * starts at the last match start, worker/analyze.go), a knife round is left
 * out here (a round where every kill was a knife), and a kill on a teammate
 * or a bot is never a moment.
 *
 * Each moment has a `key` that names it without its tick, so a re-parse of
 * the same map finds the same moment again (./momentStore.ts turns it into
 * the stable id).
 *
 * Pure: no database (tests/api/highlight-facts.spec.ts).
 */

import type { JsonObject } from '../../../utils/json';

export const MOMENT_KINDS = [
  'knife_kill',
  'zeus_kill',
  'ace',
  'clutch_1vN',
  'noscope_kill',
  'grenade_kill',
  'bomb_defuse_last_second',
] as const;

export type MomentKind = (typeof MOMENT_KINDS)[number];

export interface FoundMoment {
  /** Names the moment within its map without its tick: `knife_kill:7:<attacker>:<victim>`. */
  key: string;
  kind: MomentKind;
  round: number;
  tick: number;
  playerId: string;
  victimId: string | null;
  weapon: string | null;
  detail: JsonObject;
}

/** A kill as the analysis stores it (worker/stats.go `Kill`). */
export interface MomentKill {
  tick: number;
  round: number;
  attacker: string | null;
  victim: string;
  victimBot?: boolean;
  weapon?: string;
  headshot?: boolean;
  penetrated?: boolean;
  throughSmoke?: boolean;
  /** CS2's kill feed marks: no scope, the killer flashed, in the air. */
  noScope?: boolean;
  attackerBlind?: boolean;
  inAir?: boolean;
  /** A headshot with the only bullet he fired at that moment (worker oneTap). */
  oneTap?: boolean;
  opening?: boolean;
  attackerSide?: string | null;
  victimSide?: string | null;
}

export interface MomentRound {
  number: number;
  startTick: number;
  endTick: number;
  winner: string | null;
}

/** What the moments need of the 2D replay (worker/analyze.go `Replay`). */
export interface MomentReplay {
  tickrate?: number;
  players?: Array<{ id: string; name?: string }>;
  /** [tick, per player (players' order): [x, y, yaw, health, team 2|3, z] or null]. */
  frames?: Array<[number, Array<number[] | null>]>;
  bomb?: Array<{
    tick: number;
    kind: string;
    site?: string;
    x?: number;
    y?: number;
    player?: string;
  }>;
}

const STEAM_ID = /^\d{17}$/;
const KNIFE = /^(knife|bayonet)/i;
const ZEUS = /^zeus/i;
const GRENADE = /^(HE Grenade|Molotov|Incendiary Grenade)$/i;
const SNIPER = /^(AWP|SSG 08|SCAR-20|G3SG1)$/i;
/** CS2's bomb timer (mp_c4timer), seconds. */
export const C4_SECONDS = 40;
/** A defuse with less than this left on the bomb is a last-second one. */
export const LAST_SECOND = 1;
/** At least this many kills, all with a knife: a knife round, not a real one. */
const KNIFE_ROUND_KILLS = 3;

const TEAM_SIDE: Record<number, string> = { 2: 'T', 3: 'CT' };

/** A round of nothing but knife kills (the knife round for sides). */
export function isKnifeRound(kills: ReadonlyArray<Pick<MomentKill, 'weapon'>>): boolean {
  return kills.length >= KNIFE_ROUND_KILLS && kills.every((k) => KNIFE.test(k.weapon ?? ''));
}

/** A kill of one human on an enemy human: the only kind that can be a moment. */
function isEnemyKill(k: MomentKill): k is MomentKill & { attacker: string } {
  return (
    !!k.attacker &&
    STEAM_ID.test(k.attacker) &&
    STEAM_ID.test(k.victim) &&
    !k.victimBot &&
    k.attacker !== k.victim &&
    !!k.attackerSide &&
    !!k.victimSide &&
    k.attackerSide !== k.victimSide
  );
}

/** Which kill kind a weapon (and the no-scope mark) makes, if any. */
export function killKind(k: Pick<MomentKill, 'weapon' | 'noScope'>): MomentKind | null {
  const weapon = k.weapon ?? '';
  if (KNIFE.test(weapon)) return 'knife_kill';
  if (ZEUS.test(weapon)) return 'zeus_kill';
  if (GRENADE.test(weapon)) return 'grenade_kill';
  if (SNIPER.test(weapon) && k.noScope) return 'noscope_kill';
  return null;
}

/**
 * Who played a round, by side: the players alive in the replay's last frame
 * before the round's first death (everyone is still up then). Null without a
 * replay, or a frame in that window.
 */
function rosterFromReplay(
  replay: MomentReplay | undefined,
  round: MomentRound,
  firstDeath: number
): Map<string, string> | null {
  if (!replay?.frames?.length || !replay.players?.length) return null;
  let best: [number, Array<number[] | null>] | null = null;
  for (const frame of replay.frames) {
    if (frame[0] <= round.startTick) continue;
    if (frame[0] >= firstDeath) break;
    best = frame;
  }
  if (!best) return null;
  const roster = new Map<string, string>();
  best[1].forEach((cell, i) => {
    const id = replay.players![i]?.id;
    const side = cell ? TEAM_SIDE[cell[4]!] : undefined;
    if (id && side && (cell![3] ?? 0) > 0) roster.set(id, side);
  });
  return roster.size > 0 ? roster : null;
}

/**
 * Without a replay: the teams as the kills show them (players seen on the
 * same side in a round are one team), each on the side its players had in
 * this round. Every member counts as playing, so a substitute makes a clutch
 * look harder to finish, never easier: no clutch is found that wasn't one.
 */
function rosterFromKills(kills: MomentKill[], round: number): Map<string, string> {
  // A bot in the round: who else was up is a guess, so no clutch from it.
  const humans = (id: string | null | undefined) => !id || STEAM_ID.test(id);
  if (kills.some((k) => k.round === round && (!humans(k.attacker) || !humans(k.victim)))) {
    return new Map();
  }
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let at = id;
    for (let next = parent.get(at); next !== undefined && next !== at; next = parent.get(at))
      at = next;
    parent.set(id, at);
    return at;
  };
  const add = (id: string) => {
    if (!parent.has(id)) parent.set(id, id);
  };
  const bySide = new Map<string, string>();
  for (const k of kills) {
    for (const [id, side] of [
      [k.attacker, k.attackerSide],
      [k.victim, k.victimSide],
    ] as const) {
      if (!id || !side || !STEAM_ID.test(id)) continue;
      add(id);
      const key = `${k.round}:${side}`;
      const other = bySide.get(key);
      if (other) parent.set(find(id), find(other));
      else bySide.set(key, id);
    }
  }
  // Each team's side in this round, from any member seen in it.
  const teamSide = new Map<string, string>();
  for (const k of kills) {
    if (k.round !== round) continue;
    if (k.attacker && k.attackerSide) teamSide.set(find(k.attacker), k.attackerSide);
    if (k.victimSide) teamSide.set(find(k.victim), k.victimSide);
  }
  const roster = new Map<string, string>();
  for (const id of parent.keys()) {
    const side = teamSide.get(find(id));
    if (side) roster.set(id, side);
  }
  return roster;
}

/** Last alive on their side, against N ≥ 3, and the round won. */
function clutches(
  round: MomentRound,
  roundKills: MomentKill[],
  roster: Map<string, string>
): FoundMoment[] {
  if (!round.winner) return [];
  const side = round.winner;
  const mates = [...roster].filter(([, s]) => s === side).map(([id]) => id);
  const enemies = [...roster].filter(([, s]) => s !== side).map(([id]) => id);
  if (mates.length < 2) return [];
  const deathTick = new Map<string, number>();
  for (const k of roundKills) if (!deathTick.has(k.victim)) deathTick.set(k.victim, k.tick);
  const out: FoundMoment[] = [];
  for (const player of mates) {
    if (!STEAM_ID.test(player)) continue;
    const others = mates.filter((m) => m !== player);
    if (!others.every((m) => deathTick.has(m))) continue;
    const alone = Math.max(...others.map((m) => deathTick.get(m)!));
    const died = deathTick.get(player);
    if (died !== undefined && died <= alone) continue;
    const against = enemies.filter((e) => {
      const at = deathTick.get(e);
      return at === undefined || at > alone;
    }).length;
    if (against < 3) continue;
    const kills = roundKills.filter(
      (k) => k.attacker === player && k.tick > alone && isEnemyKill(k)
    );
    out.push({
      key: `clutch_1vN:${round.number}:${player}`,
      kind: 'clutch_1vN',
      round: round.number,
      tick: alone,
      playerId: player,
      victimId: null,
      weapon: null,
      detail: { against, kills: kills.length },
    });
  }
  return out;
}

/** The CT nearest the bomb in the replay's last frame at or before `tick`. */
function defuserAt(replay: MomentReplay, tick: number, x?: number, y?: number): string | null {
  if (x === undefined || y === undefined || !replay.frames?.length || !replay.players?.length) {
    return null;
  }
  let frame: [number, Array<number[] | null>] | null = null;
  for (const f of replay.frames) {
    if (f[0] > tick) break;
    frame = f;
  }
  if (!frame) return null;
  let best: { id: string; d: number } | null = null;
  frame[1].forEach((cell, i) => {
    const id = replay.players![i]?.id;
    if (!id || !cell || TEAM_SIDE[cell[4]!] !== 'CT' || (cell[3] ?? 0) <= 0) return;
    const d = Math.hypot(cell[0]! - x, cell[1]! - y);
    if (!best || d < best.d) best = { id, d };
  });
  return (best as { id: string; d: number } | null)?.id ?? null;
}

/** Defuses with under a second left on the bomb. */
function lastSecondDefuses(replay: MomentReplay | undefined, rounds: MomentRound[]): FoundMoment[] {
  const events = (replay?.bomb ?? []).slice().sort((a, b) => a.tick - b.tick);
  const tickrate = replay?.tickrate && replay.tickrate > 0 ? replay.tickrate : 64;
  const out: FoundMoment[] = [];
  let planted: number | null = null;
  let plantRound: number | null = null;
  for (const e of events) {
    const round = rounds.find((r) => e.tick > r.startTick && e.tick <= r.endTick);
    if (e.kind === 'planted') {
      planted = e.tick;
      plantRound = round?.number ?? null;
      continue;
    }
    if (e.kind !== 'defused' || planted === null || !round || round.number !== plantRound) continue;
    const left = C4_SECONDS - (e.tick - planted) / tickrate;
    planted = null;
    if (left < 0 || left >= LAST_SECOND) continue;
    const player =
      e.player && STEAM_ID.test(e.player) ? e.player : defuserAt(replay!, e.tick, e.x, e.y);
    if (!player || !STEAM_ID.test(player)) continue;
    out.push({
      key: `bomb_defuse_last_second:${round.number}`,
      kind: 'bomb_defuse_last_second',
      round: round.number,
      tick: e.tick,
      playerId: player,
      victimId: null,
      weapon: null,
      detail: { secondsLeft: Math.round(left * 1000) / 1000, ...(e.site ? { site: e.site } : {}) },
    });
  }
  return out;
}

/** Every notable moment of one map, in tick order. */
export function findMoments(
  analysis: { rounds: ReadonlyArray<MomentRound>; kills: ReadonlyArray<MomentKill> },
  replay?: MomentReplay
): FoundMoment[] {
  const allKills = analysis.kills
    .filter((k) => k && Number.isFinite(k.tick) && Number.isFinite(k.round))
    .slice()
    .sort((a, b) => a.tick - b.tick);
  const byRound = new Map<number, MomentKill[]>();
  for (const k of allKills) {
    const list = byRound.get(k.round) ?? [];
    list.push(k);
    byRound.set(k.round, list);
  }
  const rounds = analysis.rounds
    .filter((r) => Number.isFinite(r.number))
    .filter((r) => !isKnifeRound(byRound.get(r.number) ?? []));
  const real = new Set(rounds.map((r) => r.number));
  const kills = allKills.filter((k) => real.has(k.round));

  const out: FoundMoment[] = [];
  for (const k of kills) {
    if (!isEnemyKill(k)) continue;
    const kind = killKind(k);
    if (!kind) continue;
    out.push({
      key: `${kind}:${k.round}:${k.attacker}:${k.victim}`,
      kind,
      round: k.round,
      tick: k.tick,
      playerId: k.attacker,
      victimId: k.victim,
      weapon: k.weapon ?? null,
      detail: k.headshot ? { headshot: true } : {},
    });
  }

  for (const round of rounds) {
    const roundKills = byRound.get(round.number) ?? [];
    // Ace: five enemies (or more, a 5v5 has five) down to one player.
    const victims = new Map<string, MomentKill[]>();
    for (const k of roundKills) {
      if (!isEnemyKill(k)) continue;
      const list = victims.get(k.attacker) ?? [];
      if (!list.some((v) => v.victim === k.victim)) list.push(k);
      victims.set(k.attacker, list);
    }
    for (const [player, list] of victims) {
      if (list.length < 5) continue;
      out.push({
        key: `ace:${round.number}:${player}`,
        kind: 'ace',
        round: round.number,
        tick: list[list.length - 1]!.tick,
        playerId: player,
        victimId: null,
        weapon: null,
        detail: {
          kills: list.length,
          weapons: [...new Set(list.map((k) => k.weapon).filter((w): w is string => !!w))],
        },
      });
    }
    if (roundKills.length > 0) {
      const roster =
        rosterFromReplay(replay, round, roundKills[0]!.tick) ??
        rosterFromKills(kills, round.number);
      out.push(...clutches(round, roundKills, roster));
    }
  }

  out.push(...lastSecondDefuses(replay, rounds));
  return out.sort((a, b) => a.tick - b.tick || a.key.localeCompare(b.key));
}
