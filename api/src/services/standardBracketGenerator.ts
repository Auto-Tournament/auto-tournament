import { BracketsManager } from 'brackets-manager';
import { InMemoryDatabase } from 'brackets-memory-db';
import type { Match, StageType, StageSettings } from 'brackets-model';
import { log } from '../utils/logger';
import type { TournamentResponse } from '../types/tournament.types';
import type { IBracketGenerator, BracketGeneratorResult } from './bracketGenerators/types';
import { determineInitialMatchStatus } from '../utils/matchStatusHelpers';
import { isPowerOfTwo, padWithByes, resolveByes } from './bracketByes';

type DropInOrdering = 'natural' | 'reverse' | 'half_shift' | 'reverse_half_shift' | 'pair_flip';

/**
 * How the losers of each upper-bracket round are laid over the lower-bracket
 * round they drop into, per bracket size. Index 0 is WB round 1 (its losers
 * pair up with each other in LB round 1, so it is always natural); index r-1
 * is WB round r. These are brackets-manager's `defaultMinorOrdering` values.
 *
 * The point is the crossover: a team losing in WB round r has only played
 * teams from its own part of the upper bracket, so it is sent to the lower
 * bracket match fed from the other part. With natural order (the old wiring)
 * the loser of WB r2m1 met the winner of lb-r1m1, i.e. a team it had just
 * knocked out in WB round 1. Reverse for round 2 fixes that; for 16+ teams
 * the later rounds also keep the halves apart for as long as that is
 * possible (reverse_half_shift, then reverse or half_shift).
 */
const DROP_IN_ORDERING: Record<number, DropInOrdering[]> = {
  4: ['natural', 'reverse'],
  8: ['natural', 'reverse', 'natural'],
  16: ['natural', 'reverse_half_shift', 'reverse', 'natural'],
  32: ['natural', 'reverse', 'half_shift', 'natural', 'natural'],
  64: ['natural', 'reverse', 'half_shift', 'reverse', 'natural', 'natural'],
  128: ['natural', 'reverse', 'half_shift', 'pair_flip', 'pair_flip', 'pair_flip', 'natural'],
};

function applyOrdering<T>(method: DropInOrdering, array: T[]): T[] {
  const half = array.length / 2;
  switch (method) {
    case 'reverse':
      return [...array].reverse();
    case 'half_shift':
      return [...array.slice(half), ...array.slice(0, half)];
    case 'reverse_half_shift':
      return [...array.slice(0, half).reverse(), ...array.slice(half).reverse()];
    case 'pair_flip': {
      const out: T[] = [];
      for (let i = 0; i < array.length; i += 2) out.push(array[i + 1], array[i]);
      return out;
    }
    default:
      return [...array];
  }
}

/**
 * The matches of WB round `wbRound` in the order their losers fill the
 * lower-bracket round they drop into. Sizes past the table get round 2
 * reversed and round 3 half-shifted, the part every listed size shares.
 */
export function dropInOrder<T>(teamCount: number, wbRound: number, wbMatches: T[]): T[] {
  const table = DROP_IN_ORDERING[teamCount];
  const method: DropInOrdering = table
    ? (table[wbRound - 1] ?? 'natural')
    : wbRound === 2
      ? 'reverse'
      : wbRound === 3
        ? 'half_shift'
        : 'natural';
  return applyOrdering(method, wbMatches);
}

/**
 * Standard Bracket Generator
 * Generates single elimination, double elimination, and round robin brackets
 * using the brackets-manager library
 */
export class StandardBracketGenerator implements IBracketGenerator {
  private manager: BracketsManager;
  private storage: InMemoryDatabase;

  constructor() {
    this.storage = new InMemoryDatabase();
    this.manager = new BracketsManager(this.storage);
  }

  /**
   * Generate bracket using brackets-manager and convert to our schema
   */
  async generate(tournament: TournamentResponse): Promise<BracketGeneratorResult> {
    const { teamIds, type, settings } = tournament;

    // For power-of-two single / double elimination tournaments, bypass
    // brackets-manager and use deterministic, slot-wired generators. These
    // produce canonical topologies with explicit wiring that are independent
    // of any external library behaviour.
    if (
      type === 'single_elimination' &&
      teamIds.length > 0 &&
      (teamIds.length & (teamIds.length - 1)) === 0 // power of two
    ) {
      return this.generatePowerOfTwoSingleElimination(tournament);
    }

    if (
      type === 'double_elimination' &&
      teamIds.length > 0 &&
      (teamIds.length & (teamIds.length - 1)) === 0 && // power of two
      (settings.grandFinalMode === undefined || settings.grandFinalMode !== 'none')
    ) {
      return this.generatePowerOfTwoDoubleElimination(tournament);
    }

    // Any other team count (3, 5, 6, …): the bracket for the next power of
    // two with byes for the top seeds, then the byes taken out (bracketByes.ts).
    if (
      (type === 'single_elimination' || type === 'double_elimination') &&
      teamIds.length > 2 &&
      !isPowerOfTwo(teamIds.length)
    ) {
      return this.generateWithByes(tournament);
    }

    // Map our tournament types to brackets-manager types
    const stageType = this.mapTournamentType(type);

    // Create participants
    const participants = teamIds.map((teamId, index) => ({
      id: index,
      tournament_id: 0,
      name: teamId, // Use team ID as name for now
    }));

    // Configure stage settings
    // Note: Don't set 'size' for elimination tournaments - let the library calculate it
    // based on seeding array to properly handle non-power-of-2 team counts
    const stageSettings: Partial<StageSettings> = {
      seedOrdering: settings.seedingMethod === 'random' ? ['natural'] : ['natural'],
      consolationFinal: settings.thirdPlaceMatch,
    };

    // Configure grand final behaviour for double elimination tournaments. We
    // currently support:
    //  - 'none'   → no cross‑bracket grand final (winners bracket final decides champion)
    //  - 'simple' → single grand final between WB winner and LB winner
    //  - 'double' → reserved for future "bracket reset" support; for now this
    //               is treated as 'simple' at generation time so the bracket
    //               shape remains compatible.
    if (type === 'double_elimination') {
      const mode = settings.grandFinalMode ?? 'simple';
      const effective: StageSettings['grandFinal'] = mode === 'none' ? 'none' : 'simple';
      stageSettings.grandFinal = effective;
    } else {
      stageSettings.grandFinal = 'none';
    }

    // For round robin, size and groupCount are required
    if (stageType === 'round_robin') {
      stageSettings.size = teamIds.length;
      stageSettings.groupCount = 1; // Single group - everyone plays everyone
    }

    try {
      // Create the stage (tournament)
      const seedingArray = participants.map((p) => p.name);
      log.debug(
        `Creating stage with ${teamIds.length} teams, seeding: ${JSON.stringify(seedingArray)}`
      );

      await this.manager.create.stage({
        name: tournament.name,
        tournamentId: 0,
        type: stageType,
        seeding: seedingArray,
        settings: stageSettings,
      });

      log.debug(`Stage created, checking generated matches...`);

      // Get the generated matches
      const matches = await this.storage.select('match');
      const stages = await this.storage.select('stage');
      const stage = stages && stages.length > 0 ? stages[0] : null;

      if (!stage) {
        throw new Error('Failed to create stage');
      }

      if (!matches || matches.length === 0) {
        throw new Error(`Failed to generate ${stageType} bracket with ${teamIds.length} teams`);
      }

      // Debug: Log first round matches to see if teams are assigned
      const firstRoundMatches = (matches as Match[]).filter((m) => {
        const roundId =
          typeof m.round_id === 'number' ? m.round_id : parseInt(String(m.round_id), 10);
        return roundId === 0; // brackets-manager uses 0-based rounds, so 0 = first round
      });

      if (firstRoundMatches.length > 0) {
        log.debug(`Generated ${firstRoundMatches.length} first round matches`);
        const matchesWithTeams = firstRoundMatches.filter(
          (m) =>
            (m.opponent1?.id !== undefined && m.opponent1.id !== null) ||
            (m.opponent2?.id !== undefined && m.opponent2.id !== null)
        );
        log.debug(`${matchesWithTeams.length} first round matches have opponents assigned`);

        // Detailed logging for debugging
        firstRoundMatches.forEach((m, idx) => {
          log.debug(
            `First round match ${idx + 1}: opponent1.id=${
              m.opponent1?.id ?? 'null'
            }, opponent2.id=${m.opponent2?.id ?? 'null'}, opponent1=${JSON.stringify(
              m.opponent1
            )}, opponent2=${JSON.stringify(m.opponent2)}`
          );
        });

        if (matchesWithTeams.length === 0) {
          log.warn(
            'No first round matches have opponents assigned - this may indicate a brackets-manager issue'
          );
          log.warn(
            `Tournament has ${teamIds.length} teams, seeding: ${JSON.stringify(
              participants.map((p) => p.name)
            )}`
          );
        }
      }

      // Convert brackets-manager matches to our format
      return await this.convertMatches(matches as Match[], tournament, stageType);
    } catch (err) {
      const error = err as Error;
      log.error('Brackets-manager error', error);

      // Provide more helpful error messages
      if (error.message.includes('minimum') || error.message.includes('participants')) {
        throw new Error(
          `Cannot create ${stageType} bracket: ${error.message}. ` +
            `You have ${teamIds.length} team(s).`
        );
      }

      throw new Error(`Failed to generate ${stageType} bracket: ${error.message}`);
    }
  }

  /**
   * Map our tournament type to brackets-manager StageType
   */
  private mapTournamentType(type: TournamentResponse['type']): StageType {
    switch (type) {
      case 'single_elimination':
        return 'single_elimination';
      case 'double_elimination':
        return 'double_elimination';
      case 'round_robin':
        return 'round_robin';
      case 'swiss':
        // brackets-manager doesn't support Swiss directly, we'll need custom logic
        throw new Error('Swiss tournaments require custom implementation');
      default:
        throw new Error(`Unsupported tournament type: ${type}`);
    }
  }

  /**
   * Convert brackets-manager matches to our database format
   */
  private async convertMatches(
    bmMatches: Match[],
    tournament: TournamentResponse,
    stageType: StageType
  ): Promise<{
    matches: Array<{
      slug: string;
      round: number;
      matchNum: number;
      team1Id: string | null;
      team2Id: string | null;
      winnerId: string | null;
      status: 'pending' | 'ready' | 'loaded' | 'live' | 'completed';
      nextMatchId: number | null;
    }>;
  }> {
    const matches = await Promise.all(
      bmMatches.map(async (bmMatch) => {
        // Determine match slug based on type and position
        const slug = this.generateSlug(bmMatch, stageType);

        // Convert round_id to number (brackets-manager uses 0-based rounds)
        const bmRoundNum =
          typeof bmMatch.round_id === 'number'
            ? bmMatch.round_id
            : parseInt(String(bmMatch.round_id), 10);

        // Convert to 1-based rounds for our system (Round 0 -> Round 1, Round 1 -> Round 2, etc.)
        const roundNum = bmRoundNum + 1;

        // Map team IDs (brackets-manager uses indices, we use actual team IDs).
        // For double elimination we intentionally leave **all** losers bracket
        // matches (lb-...) and all winners‑bracket matches beyond Round 1
        // without concrete team assignments so that progression is handled
        // by our progression helpers. Only the opening winners round gets
        // seeded directly.
        let team1Id: string | null = null;
        let team2Id: string | null = null;

        const isLosersBracketSlug = slug.startsWith('lb-');
        const isGrandFinalSlug = slug === 'gf';
        const isFirstWinnersRound =
          !isLosersBracketSlug &&
          !isGrandFinalSlug &&
          roundNum === 1 &&
          stageType !== 'round_robin';

        const shouldSeedDirectly =
          stageType === 'single_elimination' ||
          (stageType === 'double_elimination' && isFirstWinnersRound) ||
          stageType === 'round_robin';

        if (shouldSeedDirectly) {
          // Check opponent1 - brackets-manager uses participant indices
          if (bmMatch.opponent1) {
            if (
              typeof bmMatch.opponent1.id === 'number' &&
              bmMatch.opponent1.id >= 0 &&
              bmMatch.opponent1.id < tournament.teamIds.length
            ) {
              team1Id = tournament.teamIds[bmMatch.opponent1.id] || null;
            }
          }

          // Check opponent2 - brackets-manager uses participant indices
          if (bmMatch.opponent2) {
            if (
              typeof bmMatch.opponent2.id === 'number' &&
              bmMatch.opponent2.id >= 0 &&
              bmMatch.opponent2.id < tournament.teamIds.length
            ) {
              team2Id = tournament.teamIds[bmMatch.opponent2.id] || null;
            }
          }

          // Log warning if a seeded first round match has no teams (shouldn't happen)
          if (roundNum === 1 && (!team1Id || !team2Id)) {
            log.warn(
              `First round match ${slug} missing teams: team1=${team1Id}, team2=${team2Id}, opponent1.id=${bmMatch.opponent1?.id}, opponent2.id=${bmMatch.opponent2?.id}`
            );
          }
        }

        // Determine status
        let status: 'pending' | 'ready' | 'loaded' | 'live' | 'completed';

        if (bmMatch.opponent1?.result === 'win' || bmMatch.opponent2?.result === 'win') {
          // Match is already completed
          status = 'completed';
        } else {
          // Use shared helper for initial status determination
          status = determineInitialMatchStatus(team1Id, team2Id, tournament.format, roundNum);
        }

        // Infer basic bracket grouping from slug for downstream consumers.
        let bracket: 'WB' | 'LB' | 'GF' | 'GF_RESET' | undefined;
        if (stageType === 'double_elimination') {
          if (isGrandFinalSlug) {
            bracket = 'GF';
          } else if (isLosersBracketSlug) {
            bracket = 'LB';
          } else {
            bracket = 'WB';
          }
        }

        return {
          slug,
          round: roundNum,
          matchNum: bmMatch.number,
          bracket,
          team1Id,
          team2Id,
          winnerId: null,
          status,
          nextMatchId: null, // Will be set after inserting into DB
          // Slot wiring is left undefined for brackets-manager generated shapes.
          team1FromMatchSlug: null,
          team1FromOutcome: null,
          team2FromMatchSlug: null,
          team2FromOutcome: null,
        };
      })
    );

    return { matches };
  }

  /**
   * Generate match slug based on brackets-manager match data
   */
  private generateSlug(match: Match, stageType: StageType): string {
    // Convert brackets-manager's 0-based rounds to 1-based for our slugs
    const bmRoundNum =
      typeof match.round_id === 'number' ? match.round_id : parseInt(String(match.round_id), 10);
    const roundNum = bmRoundNum + 1;

    if (stageType === 'double_elimination') {
      // Determine if it's winners bracket, losers bracket, or grand finals
      const isGrandFinal = match.group_id === 2;
      const isLosersBracket = match.group_id === 1;

      if (isGrandFinal) {
        return 'gf';
      } else if (isLosersBracket) {
        return `lb-r${roundNum}m${match.number}`;
      } else {
        return `r${roundNum}m${match.number}`;
      }
    } else {
      // Single elimination or round robin
      return `r${roundNum}m${match.number}`;
    }
  }

  /**
   * Reset the in-memory storage
   */
  reset(): void {
    this.storage = new InMemoryDatabase();
    this.manager = new BracketsManager(this.storage);
  }

  /**
   * Single or double elimination for a team count that is not a power of
   * two: generated for the next power of two with empty seats, then every
   * match that can't be played (a bye, or nothing at all) is taken out and
   * the wiring points past it. Matches whose two teams are known now start
   * ready, wherever they are in the bracket.
   */
  private async generateWithByes(tournament: TournamentResponse): Promise<BracketGeneratorResult> {
    const padded = {
      ...tournament,
      teamIds: padWithByes(tournament.teamIds) as string[],
    } as TournamentResponse;
    const full =
      tournament.type === 'double_elimination'
        ? await this.generatePowerOfTwoDoubleElimination(padded)
        : await this.generatePowerOfTwoSingleElimination(padded);
    // No grand final ('none'): the winners bracket final decides it; the
    // losers bracket still plays out, as the library's brackets do.
    const noFinal =
      tournament.type === 'double_elimination' && tournament.settings.grandFinalMode === 'none';
    const kept = resolveByes(noFinal ? full.matches.filter((m) => m.slug !== 'gf') : full.matches);
    return {
      matches: kept.map((m) => ({
        ...m,
        status:
          m.team1Id && m.team2Id
            ? determineInitialMatchStatus(m.team1Id, m.team2Id, tournament.format, m.round)
            : 'pending',
      })),
    };
  }

  /**
   * Deterministic power-of-two double-elimination generator with explicit
   * winners/losers bracket wiring. This follows a generic pattern for
   * N = 2^k teams:
   *  - Winners bracket: k rounds, N/2, N/4, ..., 1 match
   *  - Losers bracket: 2k-2 rounds, wired via fixed rules
   *  - Grand final: WB champion vs LB champion
   *
   * N = 2 (k = 1) is the degenerate case these formulas already describe: the
   * losers bracket has 2k-2 = 0 rounds, so the team that loses the single
   * winners match drops into an empty bracket and wins it by walkover. It is
   * therefore the grand final's second seed, and the same two teams meet twice.
   */
  private async generatePowerOfTwoDoubleElimination(
    tournament: TournamentResponse
  ): Promise<BracketGeneratorResult> {
    const teamIds = tournament.teamIds;
    const N = teamIds.length;
    const k = Math.log2(N);

    if (!Number.isInteger(k) || k < 1) {
      throw new Error(
        `Power-of-two double elimination generator requires N=2^k with k>=1, got ${N}`
      );
    }

    type Outcome = 'winner' | 'loser';

    interface GeneratedMatch {
      slug: string;
      bracket: 'WB' | 'LB' | 'GF';
      round: number;
      matchNum: number;
      team1Id: string | null;
      team2Id: string | null;
      team1FromMatchSlug: string | null;
      team1FromOutcome: Outcome | null;
      team2FromMatchSlug: string | null;
      team2FromOutcome: Outcome | null;
    }

    const wb: GeneratedMatch[][] = [];

    // 1) Winners bracket rounds and initial seeding
    for (let r = 1; r <= k; r++) {
      const matchesInRound = N / Math.pow(2, r);
      const roundMatches: GeneratedMatch[] = [];

      for (let m = 1; m <= matchesInRound; m++) {
        const slug = `r${r}m${m}`;
        let team1Id: string | null = null;
        let team2Id: string | null = null;

        if (r === 1) {
          const idx1 = 2 * (m - 1);
          const idx2 = idx1 + 1;
          team1Id = teamIds[idx1] ?? null;
          team2Id = teamIds[idx2] ?? null;
        }

        roundMatches.push({
          slug,
          bracket: 'WB',
          round: r,
          matchNum: m,
          team1Id,
          team2Id,
          team1FromMatchSlug: null,
          team1FromOutcome: null,
          team2FromMatchSlug: null,
          team2FromOutcome: null,
        });
      }

      wb.push(roundMatches);
    }

    // Winners bracket wiring: winner to next WB round, fixed slots
    for (let r = 1; r <= k - 1; r++) {
      const srcRound = wb[r - 1];
      const destRound = wb[r];

      for (let m = 1; m <= srcRound.length; m++) {
        const src = srcRound[m - 1];
        const destIndex = Math.ceil(m / 2) - 1;
        const dest = destRound[destIndex];

        if (m % 2 === 1) {
          dest.team1FromMatchSlug = src.slug;
          dest.team1FromOutcome = 'winner';
        } else {
          dest.team2FromMatchSlug = src.slug;
          dest.team2FromOutcome = 'winner';
        }
      }
    }

    // 2) Losers bracket rounds
    const lbTotalRounds = 2 * k - 2;
    const lb: GeneratedMatch[][] = Array.from({ length: lbTotalRounds }, () => []);

    // Create LB rounds with correct match counts
    for (let i = 1; i <= k - 1; i++) {
      const L_odd = 2 * i - 1;
      const L_even = 2 * i;
      const matchesPerRound = N / Math.pow(2, i + 1);

      const oddIndex = L_odd - 1;
      const evenIndex = L_even - 1;

      for (let m = 1; m <= matchesPerRound; m++) {
        lb[oddIndex].push({
          slug: `lb-r${L_odd}m${m}`,
          bracket: 'LB',
          round: L_odd,
          matchNum: m,
          team1Id: null,
          team2Id: null,
          team1FromMatchSlug: null,
          team1FromOutcome: null,
          team2FromMatchSlug: null,
          team2FromOutcome: null,
        });
      }

      for (let m = 1; m <= matchesPerRound; m++) {
        lb[evenIndex].push({
          slug: `lb-r${L_even}m${m}`,
          bracket: 'LB',
          round: L_even,
          matchNum: m,
          team1Id: null,
          team2Id: null,
          team1FromMatchSlug: null,
          team1FromOutcome: null,
          team2FromMatchSlug: null,
          team2FromOutcome: null,
        });
      }
    }

    // 3.1) LB Round 1: pair WB R1 losers (two WB matches into one LB match)
    {
      const i = 1;
      const L_odd = 2 * i - 1; // 1
      const oddIndex = L_odd - 1;
      const matchesPerRound = N / Math.pow(2, i + 1); // N/4

      for (let m = 1; m <= matchesPerRound; m++) {
        const lbMatch = lb[oddIndex][m - 1];
        const wbMatch1 = wb[0][2 * m - 2];
        const wbMatch2 = wb[0][2 * m - 1];

        lbMatch.team1FromMatchSlug = wbMatch1.slug;
        lbMatch.team1FromOutcome = 'loser';
        lbMatch.team2FromMatchSlug = wbMatch2.slug;
        lbMatch.team2FromOutcome = 'loser';
      }
    }

    // 3.2) LB odd rounds i>1: winners from previous LB even round
    for (let i = 2; i <= k - 1; i++) {
      const L_odd = 2 * i - 1;
      const oddIndex = L_odd - 1;
      const prevEvenIndex = L_odd - 2; // L_even - 1
      const matchesPerRound = lb[oddIndex].length;

      for (let m = 1; m <= matchesPerRound; m++) {
        const lbMatch = lb[oddIndex][m - 1];
        const prevEvenRoundMatches = lb[prevEvenIndex];
        const src1 = prevEvenRoundMatches[2 * m - 2];
        const src2 = prevEvenRoundMatches[2 * m - 1];

        lbMatch.team1FromMatchSlug = src1.slug;
        lbMatch.team1FromOutcome = 'winner';
        lbMatch.team2FromMatchSlug = src2.slug;
        lbMatch.team2FromOutcome = 'winner';
      }
    }

    // 3.3) LB even rounds: LB odd winners vs WB (i+1) losers. The WB losers
    // are crossed over (dropInOrder) so they land against the half of the
    // lower bracket they could not have met in the upper bracket.
    for (let i = 1; i <= k - 1; i++) {
      const L_even = 2 * i;
      const evenIndex = L_even - 1;
      const prevOddIndex = L_even - 2;
      const matchesPerRound = lb[evenIndex].length;
      const wbLosers = dropInOrder(N, i + 1, wb[i]);

      for (let m = 1; m <= matchesPerRound; m++) {
        const lbMatch = lb[evenIndex][m - 1];
        const lbSource = lb[prevOddIndex][m - 1];
        const wbSource = wbLosers[m - 1]; // a loser of WB round (i+1)

        lbMatch.team1FromMatchSlug = lbSource.slug;
        lbMatch.team1FromOutcome = 'winner';
        lbMatch.team2FromMatchSlug = wbSource.slug;
        lbMatch.team2FromOutcome = 'loser';
      }
    }

    // 4) Grand Final: WB final winner vs LB final winner.
    //
    // With two teams there are no losers-bracket rounds at all, so there is no
    // LB final to take a winner from: the losers-bracket champion is simply the
    // team that lost the winners final (it "wins" an empty bracket unopposed).
    // Wiring the second slot to that loser keeps the grand final a real match
    // instead of a slot that can never be filled.
    const wbFinal = wb[k - 1][0];
    const lbFinal = lbTotalRounds > 0 ? lb[lbTotalRounds - 1][0] : null;

    const gf: GeneratedMatch = {
      slug: 'gf',
      bracket: 'GF',
      round: 1,
      matchNum: 1,
      team1Id: null,
      team2Id: null,
      team1FromMatchSlug: wbFinal.slug,
      team1FromOutcome: 'winner',
      team2FromMatchSlug: lbFinal ? lbFinal.slug : wbFinal.slug,
      team2FromOutcome: lbFinal ? 'winner' : 'loser',
    };

    const allGenerated: GeneratedMatch[] = [...wb.flat(), ...lb.flat(), gf];

    // 5) Convert to BracketGeneratorResult with initial statuses
    const matches = await Promise.all(
      allGenerated.map(async (gm) => {
        // Determine initial status based on seeding
        const status =
          gm.bracket === 'WB' && gm.round === 1
            ? determineInitialMatchStatus(gm.team1Id, gm.team2Id, tournament.format, gm.round)
            : 'pending';

        return {
          slug: gm.slug,
          round: gm.round,
          matchNum: gm.matchNum,
          bracket: gm.bracket,
          team1Id: gm.team1Id,
          team2Id: gm.team2Id,
          winnerId: null,
          status,
          nextMatchId: null,
          team1FromMatchSlug: gm.team1FromMatchSlug,
          team1FromOutcome: gm.team1FromOutcome,
          team2FromMatchSlug: gm.team2FromMatchSlug,
          team2FromOutcome: gm.team2FromOutcome,
        };
      })
    );

    return { matches };
  }

  /**
   * Deterministic power-of-two single-elimination generator with explicit
   * winners-bracket wiring. This follows a generic pattern for N = 2^k teams:
   *  - Rounds: r = 1..k
   *  - Matches per round: N / 2^r
   *  - Total matches: N - 1
   */
  private async generatePowerOfTwoSingleElimination(
    tournament: TournamentResponse
  ): Promise<BracketGeneratorResult> {
    const teamIds = tournament.teamIds;
    const N = teamIds.length;
    const k = Math.log2(N);

    if (!Number.isInteger(k) || k < 1) {
      throw new Error(
        `Power-of-two single elimination generator requires N=2^k with k>=1, got ${N}`
      );
    }

    type Outcome = 'winner' | 'loser';

    interface GeneratedMatch {
      slug: string;
      bracket: 'SE';
      round: number;
      matchNum: number;
      team1Id: string | null;
      team2Id: string | null;
      team1FromMatchSlug: string | null;
      team1FromOutcome: Outcome | null;
      team2FromMatchSlug: string | null;
      team2FromOutcome: Outcome | null;
    }

    const rounds: GeneratedMatch[][] = [];

    // 1) Create rounds and seed round 1
    for (let r = 1; r <= k; r++) {
      const matchesInRound = N / Math.pow(2, r);
      const roundMatches: GeneratedMatch[] = [];

      for (let m = 1; m <= matchesInRound; m++) {
        const slug = `r${r}m${m}`;
        let team1Id: string | null = null;
        let team2Id: string | null = null;

        if (r === 1) {
          const idx1 = 2 * (m - 1);
          const idx2 = idx1 + 1;
          team1Id = teamIds[idx1] ?? null;
          team2Id = teamIds[idx2] ?? null;
        }

        roundMatches.push({
          slug,
          bracket: 'SE',
          round: r,
          matchNum: m,
          team1Id,
          team2Id,
          team1FromMatchSlug: null,
          team1FromOutcome: null,
          team2FromMatchSlug: null,
          team2FromOutcome: null,
        });
      }

      rounds.push(roundMatches);
    }

    // 2) Winners progression wiring (no losers / LB)
    for (let r = 1; r <= k - 1; r++) {
      const srcRound = rounds[r - 1];
      const destRound = rounds[r];

      for (let m = 1; m <= srcRound.length; m++) {
        const src = srcRound[m - 1];
        const destIndex = Math.ceil(m / 2) - 1;
        const dest = destRound[destIndex];

        if (m % 2 === 1) {
          dest.team1FromMatchSlug = src.slug;
          dest.team1FromOutcome = 'winner';
        } else {
          dest.team2FromMatchSlug = src.slug;
          dest.team2FromOutcome = 'winner';
        }
      }
    }

    const allGenerated: GeneratedMatch[] = rounds.flat();

    // 3) Convert to BracketGeneratorResult with initial statuses
    const matches = await Promise.all(
      allGenerated.map(async (gm) => {
        const status =
          gm.round === 1
            ? determineInitialMatchStatus(gm.team1Id, gm.team2Id, tournament.format, gm.round)
            : 'pending';

        return {
          slug: gm.slug,
          round: gm.round,
          matchNum: gm.matchNum,
          bracket: gm.bracket,
          team1Id: gm.team1Id,
          team2Id: gm.team2Id,
          winnerId: null,
          status,
          nextMatchId: null,
          team1FromMatchSlug: gm.team1FromMatchSlug,
          team1FromOutcome: gm.team1FromOutcome,
          team2FromMatchSlug: gm.team2FromMatchSlug,
          team2FromOutcome: gm.team2FromOutcome,
        };
      })
    );

    return { matches };
  }
}

// Export singleton instance
export const standardBracketGenerator = new StandardBracketGenerator();
