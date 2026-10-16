import { useEffect, useState } from 'react';
import { fmtCountdown, fmtTime, fmtWeekdayTime } from '../../../utils/time';
import { Box, Button, Typography } from '@mui/material';
import { SpeakerHighIcon, SpeakerSlashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { Tournament } from '../../../types';
import type { Registration, SignupWindow } from '../../../hooks/useTournamentSignup';
import { TeamMark, Face } from './PlayerFace';
import { InfoTile, PlayerAvatar, StatusHero } from '../ui/draftUi';
import { tokens, fontDisplay, mono, radii } from '../../../theme/tokens';
import { useSoundSettings } from '../../../hooks/useSoundSettings';

const { color } = tokens;

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Check-in on the day (boards 6 and 6b). Before you check in: a yellow banner
 * with "I'm here" and the time left. After: a green one saying to keep the
 * page open, with a countdown to the first match. Below: your team's faces
 * lighting up as people check in, and every team's count.
 */
export function CheckInPanel({
  tournament,
  window: signupWindow,
  registration,
  registrations,
  steamId,
  onCheckIn,
}: {
  tournament: Tournament;
  window: SignupWindow;
  registration: Registration;
  registrations: Registration[];
  steamId: string | null;
  onCheckIn: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const me = registration.lineup.find((p) => p.steamId === steamId) ?? null;
  const checkedIn = Boolean(me?.checkedInAt);
  // The match is called with a sound (draft 6b): on unless the player muted it.
  const sound = useSoundSettings();
  const closes = signupWindow.checkInClosesAt
    ? new Date(signupWindow.checkInClosesAt).getTime()
    : null;
  // Round 1's start time (Manage › Schedule), else the event schedule's first item.
  const matchTimes = (
    tournament.settings as
      | {
          matchTimes?: { mode?: string; rounds?: Record<string, string>; vetoLeadMinutes?: number };
        }
      | undefined
  )?.matchTimes;
  const roundOne =
    matchTimes?.mode === 'times' && matchTimes.rounds?.['1']
      ? Date.parse(matchTimes.rounds['1'])
      : NaN;
  const lead = typeof matchTimes?.vetoLeadMinutes === 'number' ? matchTimes.vetoLeadMinutes : 5;
  const firstVeto = Number.isFinite(roundOne) && roundOne > now ? roundOne - lead * 60_000 : null;
  const firstAt =
    Number.isFinite(roundOne) && roundOne > now
      ? roundOne
      : (tournament.settings?.schedule ?? [])
          .map((item) => new Date(item.at).getTime())
          .filter((time) => Number.isFinite(time) && time > now)
          .sort((a, b) => a - b)[0];
  const starters = registration.lineup.filter((p) => p.role === 'starter');
  const startersIn = starters.filter((p) => p.checkedInAt).length;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }} data-testid="signup-checkin">
      <StatusHero
        eyebrow={
          closes
            ? t('signup.checkIn.closesIn', {
                time: fmtWeekdayTime(closes),
                left: fmtCountdown(closes, now),
              })
            : t('signup.checkIn.open')
        }
        eyebrowColor={color.live}
        ring={me && !checkedIn ? color.live : color.rule}
        title={
          me
            ? checkedIn
              ? t('signup.checkIn.done')
              : t('checkIn.areYouHere')
            : t('signup.checkIn.teamTitle', { team: registration.teamName })
        }
        body={
          <>
            {t('checkIn.teamCount', {
              team: registration.teamName,
              in: startersIn,
              total: starters.length,
            })}
            {firstVeto && (
              <Box component="span" data-testid="signup-first-veto">
                {' '}
                {t('checkIn.firstVeto', { time: fmtTime(firstVeto), count: lead })}
              </Box>
            )}
          </>
        }
        side={
          <>
            {firstAt && (
              <InfoTile
                mono
                label={t('signup.checkIn.firstMatchIn')}
                value={<span data-testid="signup-countdown">{fmtCountdown(firstAt, now)}</span>}
                note={
                  firstVeto
                    ? t('checkIn.vetoOpensNote', { time: fmtTime(firstVeto) })
                    : fmtWeekdayTime(firstAt)
                }
              />
            )}
            {me && !checkedIn && (
              <Button
                variant="contained"
                disabled={busy}
                data-testid="signup-check-in"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onCheckIn();
                  } finally {
                    setBusy(false);
                  }
                }}
                sx={{
                  minHeight: 56,
                  borderRadius: radii.pill,
                  fontWeight: 700,
                  fontSize: '1.125rem',
                }}
              >
                {t('signup.checkIn.imHere')}
              </Button>
            )}
            {me && (
              <Button
                variant="outlined"
                onClick={sound.toggleMute}
                aria-pressed={!sound.isMuted}
                data-testid="signup-sound"
                startIcon={
                  sound.isMuted ? (
                    <SpeakerSlashIcon size={16} aria-hidden />
                  ) : (
                    <SpeakerHighIcon size={16} aria-hidden />
                  )
                }
                sx={{ minHeight: 44, borderRadius: radii.pill }}
              >
                {sound.isMuted ? t('signup.checkIn.soundOff') : t('checkIn.soundOn')}
              </Button>
            )}
          </>
        }
      >
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {registration.lineup.map((p) => (
            <Box
              key={p.steamId}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 0.5,
                width: 64,
                textAlign: 'center',
              }}
            >
              <PlayerAvatar
                name={p.name}
                avatar={p.avatar}
                size={44}
                sx={{
                  outline: `2px solid ${p.checkedInAt ? color.live : color.rule}`,
                  outlineOffset: 2,
                  opacity: p.checkedInAt ? 1 : 0.6,
                }}
              />
              <Typography
                component="span"
                sx={{
                  fontSize: '0.75rem',
                  color: p.checkedInAt ? color.ink : color.muted,
                  overflowWrap: 'anywhere',
                }}
              >
                {p.name}
              </Typography>
            </Box>
          ))}
        </Box>
        <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
          {t('signup.checkIn.keepOpen')}
        </Typography>
      </StatusHero>

      <Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography
            component="h2"
            sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}
          >
            {t('signup.checkIn.everyone')}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 16rem), 1fr))',
              gap: 1.25,
            }}
          >
            {registrations.map((reg) => {
              const regStarters = reg.lineup.filter((p) => p.role === 'starter');
              const inCount = regStarters.filter((p) => p.checkedInAt).length;
              const own = reg.teamId === registration.teamId;
              return (
                <Box
                  key={reg.teamId}
                  sx={{
                    p: 1.75,
                    borderRadius: '18px',
                    bgcolor: color.paper2,
                    border: `1px solid ${own ? color.accent : color.rule}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1.5,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                    <TeamMark tag={reg.teamTag} name={reg.teamName} highlight={own} />
                    <Typography
                      sx={{
                        fontWeight: 600,
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {reg.teamName}
                    </Typography>
                    <Typography
                      sx={{
                        ...mono,
                        fontSize: '0.8125rem',
                        color: inCount === regStarters.length ? color.live : color.sideT,
                      }}
                    >
                      {inCount}/{regStarters.length}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex' }}>
                    {regStarters.map((p, i) => (
                      <Box key={p.steamId} sx={{ ml: i === 0 ? 0 : '-10px' }}>
                        <Face name={p.name} avatar={p.avatar} size={30} dim={!p.checkedInAt} />
                      </Box>
                    ))}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
