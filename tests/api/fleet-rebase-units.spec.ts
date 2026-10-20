import { test, expect } from '@playwright/test';
import { supersededAssignments } from '../../api/src/integrations/cs2/fleet/registry';
import type { Envelope } from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * api/src/integrations/cs2/fleet/registry `supersededAssignments`: when a
 * server's lost stream is renumbered, only each match's newest assignment is
 * sent again.
 *
 * @tag api
 */

const msg = (id: string, type: string, match: string | null, epoch?: number): Envelope =>
  ({
    v: 1,
    id,
    type,
    ts: 0,
    ...(epoch !== undefined ? { epoch } : {}),
    payload: match ? { match_id: match, epoch } : {},
  }) as Envelope;

test(
  'older assignments of a match are dropped; the newest and other messages stay',
  { tag: ['@api'] },
  () => {
    const queue = [
      msg('a1', 'match.assign', 'm1', 1),
      msg('u1', 'match.unassign', 'm1', 1),
      msg('c1', 'cmd', null),
      msg('a2', 'match.assign', 'm1', 2),
      msg('u2', 'match.unassign', 'm1', 2),
      msg('a3', 'match.assign', 'm1', 3),
      msg('b1', 'match.assign', 'm2', 1),
    ];
    expect([...supersededAssignments(queue)].sort()).toEqual(['a1', 'a2', 'u1', 'u2']);
    expect(supersededAssignments([msg('x', 'match.assign', 'm1', 4)]).size).toBe(0);
  }
);
