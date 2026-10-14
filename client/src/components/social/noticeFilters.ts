/**
 * The notification center's filters (the bell and the Notifications page):
 * what waits on you, your match, tournaments, skins, clips and the rest.
 */
import type { Notice } from './socialStore';

export type NoticeFilter = 'all' | 'you' | 'matches' | 'tournaments' | 'skins' | 'clips' | 'other';

/** The filters, in the order the bell and the Notifications page show them. */
export const NOTICE_FILTERS: NoticeFilter[] = [
  'all',
  'you',
  'matches',
  'tournaments',
  'skins',
  'clips',
  'other',
];

/** Your own match: it is ready, or it is your team's turn in the veto. */
function isMatchNotice(n: Notice): boolean {
  return (
    n.kind === 'tournament' && (n.data.event === 'match_ready' || n.data.event === 'veto_turn')
  );
}

export function matchesFilter(n: Notice, filter: NoticeFilter): boolean {
  switch (filter) {
    case 'you':
      // What waits on you: an answer, or your match.
      return (
        n.kind === 'party_invite' ||
        n.kind === 'team_invite' ||
        n.kind === 'friend_request' ||
        n.kind === 'friend_accepted' ||
        isMatchNotice(n)
      );
    case 'matches':
      return isMatchNotice(n);
    case 'tournaments':
      return n.kind === 'tournament' && !isMatchNotice(n);
    case 'skins':
      return n.kind === 'skin';
    case 'clips':
      return n.kind === 'highlight';
    case 'other':
      return n.kind === 'news' || n.kind === 'report';
    default:
      return true;
  }
}
