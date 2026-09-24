import { test, expect } from '@playwright/test';
import {
  isActiveMatchStatus,
  isIdleServerReport,
  resolveReportTarget,
} from '../../api/src/utils/serverAttribution';

/**
 * Which match a report posted by the plugin applies to (pure rules, no API).
 *
 * Seen on the QA servers: r1m4 completed on s_3 at 1789549362. The plugin reset
 * to idle at 1789549498 but kept reporting `at_tournament_match = 36`
 * (r1m4's id). MAT then ingested two reports for r1m4 from s_3 at 1789549538,
 * after the reset and before r1m1 was loaded there at 1789549547. The route also fell
 * back to `SELECT * FROM matches WHERE server_id = ?` with no status filter, so
 * a report naming no match could land on any match the server had ever played.
 *
 * The API-level behaviour is covered in idle-server-report.spec.ts.
 *
 * @tag api
 * @tag regression
 */

type Row = { id: number; slug: string; server_id: string | null; status: string };

const completedOnS3: Row = { id: 36, slug: 'r1m4', server_id: 's_3', status: 'completed' };
const liveOnS3: Row = { id: 33, slug: 'r1m1', server_id: 's_3', status: 'live' };
const liveOnS2: Row = { id: 38, slug: 'r2m2', server_id: 's_2', status: 'live' };

function lookups(rows: Row[]) {
  return {
    findByIdentifier: async (identifier: string | number) =>
      rows.find((r) => String(r.id) === String(identifier) || r.slug === String(identifier)) ?? null,
    findActiveForServer: async (serverId: string) =>
      rows.find((r) => r.server_id === serverId && isActiveMatchStatus(r.status)) ?? null,
  };
}

const livePhase = { match: { phase: 'live' } };
const idlePhase = { match: { phase: 'idle' } };

test.describe('Match report target', () => {
  test('only loaded and live count as active', () => {
    expect(isActiveMatchStatus('loaded')).toBe(true);
    expect(isActiveMatchStatus('live')).toBe(true);
    for (const status of ['pending', 'ready', 'completed', 'cancelled', '', null, undefined]) {
      expect(isActiveMatchStatus(status)).toBe(false);
    }
  });

  test('idle phase is a server with no match loaded', () => {
    expect(isIdleServerReport(idlePhase)).toBe(true);
    expect(isIdleServerReport({ match: { phase: ' IDLE ' } })).toBe(true);
    expect(isIdleServerReport(livePhase)).toBe(false);
    expect(isIdleServerReport({})).toBe(false);
    expect(isIdleServerReport(null)).toBe(false);
  });

  test('a report without a match id uses only the active match on that server', async () => {
    const onlyCompleted = await resolveReportTarget(
      { serverId: 's_3', matchSlug: undefined, report: livePhase },
      lookups([completedOnS3])
    );
    expect(onlyCompleted).toEqual({ kind: 'ignore', reason: 'no-match' });

    const withActive = await resolveReportTarget(
      { serverId: 's_3', matchSlug: 'unassigned', report: livePhase },
      lookups([completedOnS3, liveOnS3, liveOnS2])
    );
    expect(withActive).toMatchObject({ kind: 'apply', via: 'server', match: { slug: 'r1m1' } });
  });

  test('an idle server report is ignored even when it names its previous match', async () => {
    const stale = await resolveReportTarget(
      { serverId: 's_3', matchSlug: '36', report: idlePhase },
      lookups([completedOnS3, liveOnS3])
    );
    expect(stale).toEqual({ kind: 'ignore', reason: 'idle-server' });
  });

  test('a named match still takes its postgame report after completion', async () => {
    const postgame = await resolveReportTarget(
      { serverId: 's_3', matchSlug: '36', report: { match: { phase: 'postgame' } } },
      lookups([completedOnS3])
    );
    expect(postgame).toMatchObject({ kind: 'apply', via: 'identifier', match: { slug: 'r1m4' } });
  });

  test('a named match on another server is ignored, not replaced by the fallback', async () => {
    const wrong = await resolveReportTarget(
      { serverId: 's_3', matchSlug: 'r2m2', report: livePhase },
      lookups([liveOnS2, liveOnS3])
    );
    expect(wrong).toMatchObject({ kind: 'ignore', reason: 'wrong-server', match: { slug: 'r2m2' } });
  });
});
