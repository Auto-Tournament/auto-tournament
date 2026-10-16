/**
 * What a notice says and where it leads, as plain parts: the bell's row
 * (NoticeItem) sets `lead` and `tail` in bold around `text`, and a browser
 * notification joins them into one line.
 */
import type { TFunction } from 'i18next';
import { paths, playerProfilePath, teamProfilePath } from '../../paths';
import type { Notice, Person } from './socialStore';

export function asPerson(value: unknown): Person | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Partial<Person>;
  return typeof p.id === 'string'
    ? { id: p.id, name: p.name || p.id, avatarUrl: p.avatarUrl ?? null }
    : null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export interface NoticeText {
  /** Bold, before the text: who did it, or what it is about. */
  lead: string;
  text: string;
  /** Bold, after the text: the team, the skin, the clip. */
  tail: string;
  /** A second, quieter line. */
  detail: string;
  /** Where opening it goes (an app path, or an https link for news). */
  to: string | null;
  /** A ready highlight's video, for a still. */
  thumb: string | null;
}

export function describeNotice(notice: Notice, t: TFunction, viewerId: string | null): NoticeText {
  const d = notice.data;
  const person = asPerson(d.from) ?? asPerson(d.by);
  const answer = str(d.answer);
  const out: NoticeText = { lead: '', text: '', tail: '', detail: '', to: null, thumb: null };

  switch (notice.kind) {
    case 'party_invite':
      out.lead = person?.name ?? '';
      out.text = t('social.notice.partyInvite');
      out.detail = t('social.notice.partyDetail', {
        mode: str(d.mode),
        size: Number(d.size ?? 1),
      });
      // Answered with its buttons, in the bell.
      break;
    case 'team_invite': {
      const teamId = str(d.teamId);
      out.lead = person?.name ?? '';
      out.text = t('social.notice.teamInvite');
      out.tail = str(d.teamName);
      out.to = answer === 'joinedTeam' ? teamProfilePath(teamId) : paths.communityTeams;
      break;
    }
    case 'friend_request':
      out.lead = person?.name ?? '';
      out.text = t('social.notice.friendRequest');
      out.to = person ? playerProfilePath(person.id) : null;
      break;
    case 'friend_accepted':
      out.lead = person?.name ?? '';
      out.text = t('social.notice.friendAccepted');
      out.to = person ? playerProfilePath(person.id) : null;
      break;
    case 'skin':
      out.text = t('social.notice.skin');
      out.tail = str(d.name);
      out.detail = [str(d.rarity), str(d.source)].filter(Boolean).join(' · ');
      // The skin's picture (older notices kept only a file name: no picture).
      out.thumb = /^https?:\/\//.test(str(d.image)) ? str(d.image) : null;
      // The game's own link (the inventory on that skin); older notices have none.
      out.to =
        (str(d.url).startsWith('/') ? str(d.url) : '') ||
        (viewerId ? playerProfilePath(viewerId) : null);
      break;
    case 'highlight':
      out.text =
        d.role === 'victim' || d.role === 'assist' || d.role === 'killer'
          ? t(
              `social.notice.${({ victim: 'highlightVictim', assist: 'highlightAssist', killer: 'highlightKiller' } as const)[d.role]}`,
              { name: str(d.byName) || t('social.notice.someone', { defaultValue: 'Someone' }) }
            )
          : t('social.notice.highlight');
      out.tail = str(d.title);
      // The clip's own page (older notices carry only its id).
      out.to =
        (str(d.url).startsWith('/') ? str(d.url) : '') ||
        (typeof d.highlightId === 'number' ? `/watch/clip/${d.highlightId}` : null) ||
        (viewerId ? playerProfilePath(viewerId) : null);
      out.thumb =
        (str(d.video).startsWith('/') ? str(d.video) : '') ||
        (typeof d.highlightId === 'number'
          ? `/api/game/cs2/highlights/${d.highlightId}.mp4`
          : null);
      break;
    case 'tournament':
      out.lead = str(d.name);
      // Your own match: it is ready, or it is your team's turn in its veto.
      if (
        (d.event === 'match_ready' || d.event === 'veto_turn' || d.event === 'match_soon') &&
        str(d.matchSlug)
      ) {
        out.text =
          d.event === 'match_soon'
            ? t('social.notice.matchSoon', { minutes: Number(d.minutes) || 15 })
            : d.event === 'match_ready'
              ? t('social.notice.matchReady')
              : t('social.notice.vetoTurn');
        out.to = `/match/${encodeURIComponent(str(d.matchSlug))}`;
        break;
      }
      out.text =
        d.event === 'started'
          ? t('social.notice.tournamentStarted')
          : d.event === 'starts_soon'
            ? t(
                (Number(d.minutes) || 5) >= 15
                  ? 'social.notice.startsSoonUpdate'
                  : 'social.notice.startsSoon',
                { minutes: Number(d.minutes) || 5 }
              )
            : d.event === 'lineupGap'
              ? t('social.notice.lineupGap', { minutes: Number(d.minutes) || 15 })
              : t('social.notice.checkInOpen');
      // A lineup gap: the captain picks a sub on the sign-up page.
      out.to = d.tournamentId
        ? `/tournament/${Number(d.tournamentId)}${
            d.event === 'started' ? '/match' : d.event === 'starts_soon' ? '' : '/signup'
          }`
        : null;
      break;
    case 'report':
      if (d.event === 'reviewed') {
        out.text = t('social.notice.reportReviewed', { name: str(d.name) });
      } else {
        out.lead = str(d.name);
        out.text = t('social.notice.reportNew', {
          reason: t(`report.reasons.${str(d.reason) || 'other'}`),
        });
        out.to = '/manage/reports';
      }
      break;
    case 'news':
      out.lead = str(d.title);
      out.detail = str(d.body);
      out.to = str(d.url) || null;
      break;
  }
  return out;
}

/** The notice as one line, for a browser notification. */
export function noticeLine(text: NoticeText): string {
  return [text.lead, text.text, text.tail].filter(Boolean).join(' ');
}
