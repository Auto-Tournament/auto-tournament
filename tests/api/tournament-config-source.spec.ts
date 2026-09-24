import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  normalizeTournamentSettings,
  tournamentRowToResponse,
} from '../../api/src/utils/tournamentRow';
import { formatSeriesEndSummary } from '../../api/src/utils/seriesEndSummary';
import type { DbTournamentRow } from '../../api/src/types/database.types';

/**
 * The tournament object config generation reads.
 *
 * Seen on real servers (MAT 2.4.7, MR4 Bo1): after the simulated veto, "Stored
 * fresh config for match r1m2 after automated veto" stored `maxRounds: 24`. The
 * veto simulation built the tournament by hand without maxRounds, overtime or
 * team size, so config generation fell back to Auto Tournament CS2 defaults. The config
 * served to servers was rebuilt correctly, which hid it.
 *
 * @tag api
 * @tag regression
 */
const row: DbTournamentRow = {
  id: 1,
  name: 'QA cup',
  type: 'single_elimination',
  format: 'bo1',
  status: 'in_progress',
  team_ids: JSON.stringify(['t1', 't2']),
  maps: JSON.stringify(['de_mirage', 'de_inferno']),
  created_at: 100,
  updated_at: 200,
  // Edited from bo3 to bo1: settings kept the old value.
  settings: JSON.stringify({ matchFormat: 'bo3', thirdPlaceMatch: false }),
  map_sequence: null,
  team_size: 2,
  max_rounds: 4,
  overtime_mode: 'disabled',
  overtime_segments: 0,
  elo_template_id: null,
};

test.describe('Tournament config source', () => {
  test("carries the tournament's round, overtime and team-size rules", () => {
    const t = tournamentRowToResponse(row);
    expect(t.maxRounds).toBe(4);
    expect(t.overtimeMode).toBe('disabled');
    expect(t.overtimeSegments).toBe(0);
    expect(t.teamSize).toBe(2);
    expect(t.format).toBe('bo1');
    expect(t.maps).toEqual(['de_mirage', 'de_inferno']);
    expect(t.teamIds).toEqual(['t1', 't2']);
    expect(t.updated_at).toBe(200);
  });

  test('unset columns stay unset rather than becoming null', () => {
    const t = tournamentRowToResponse({
      ...row,
      max_rounds: null,
      overtime_mode: null,
      overtime_segments: null,
      team_size: null,
      settings: undefined,
    });
    expect(t.maxRounds).toBeUndefined();
    expect(t.overtimeMode).toBeUndefined();
    expect(t.overtimeSegments).toBeUndefined();
    expect(t.teamSize).toBeUndefined();
    expect(t.settings.matchFormat).toBe('bo1');
  });

  test('no config generator hand-builds the tournament object any more', () => {
    const apiSrc = path.resolve(__dirname, '../../api/src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (full.endsWith('.ts')) {
          const source = fs.readFileSync(full, 'utf8');
          // The hand-built shape: `teamIds: JSON.parse(row.team_ids)` next to a
          // generateMatchConfig call.
          if (
            source.includes('generateMatchConfig(') &&
            /teamIds:\s*JSON\.parse\(\s*\w+\.team_ids\s*\)/.test(source)
          ) {
            offenders.push(path.relative(apiSrc, full));
          }
        }
      }
    };
    walk(apiSrc);
    expect(offenders, 'build it with tournamentRowToResponse so no column is dropped').toEqual([]);
  });

  test('settings.matchFormat follows the format column', () => {
    expect(tournamentRowToResponse(row).settings.matchFormat).toBe('bo1');
    expect(normalizeTournamentSettings({ matchFormat: 'bo3' }, 'bo5').matchFormat).toBe('bo5');
    expect(normalizeTournamentSettings({ matchFormat: 'bo3', autoAdvance: true }, 'bo1')).toEqual({
      matchFormat: 'bo1',
      autoAdvance: true,
    });
    // An unknown format leaves settings alone.
    expect(normalizeTournamentSettings({ matchFormat: 'bo3' }, undefined).matchFormat).toBe('bo3');
  });

  test('series end log names the teams even though series_end carries no names', () => {
    // Logged before: "SERIES ENDED: undefined 0-1 undefined".
    const event = { event: 'series_end', matchid: 19, team1_series_score: 0, team2_series_score: 1 };
    expect(formatSeriesEndSummary(event, { team1Name: 'Alpha', team2Name: 'Bravo' })).toBe(
      'SERIES ENDED: Alpha 0-1 Bravo'
    );
    expect(
      formatSeriesEndSummary(event, { configTeam1Name: 'Ad hoc 1', configTeam2Name: 'Ad hoc 2' })
    ).toBe('SERIES ENDED: Ad hoc 1 0-1 Ad hoc 2');
    expect(formatSeriesEndSummary({ ...event, team1: { name: 'From plugin' } }, { team1Name: 'Alpha' })).toBe(
      'SERIES ENDED: From plugin 0-1 team2'
    );
    expect(formatSeriesEndSummary({ event: 'series_end' }, {})).toBe('SERIES ENDED: team1 0-0 team2');
  });
});
