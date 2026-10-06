import { useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { CheckCircleIcon, CheckIcon, ClockIcon, SpeakerHighIcon, SpeakerSlashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { Tournament } from '../../../types';
import type { Registration, SignupWindow } from '../../../hooks/useTournamentSignup';
import { PersonTile, TeamMark, Face } from './PlayerFace';
import { tokens, fontDisplay, mono, radii, withAlpha } from '../../../theme/tokens';
import { useSoundSettings } from '../../../hooks/useSoundSettings';

const { color } = tokens;

/** "1:12:40" until `target`, or "0:00:00" once it has passed. */
function countdown(target: number, now: number): string {
  const left = Math.max(0, Math.floor((target - now) / 1000));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

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
  const { t, i18n } = useTranslation();
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const me = registration.lineup.find((p) => p.steamId === steamId) ?? null;
  const checkedIn = Boolean(me?.checkedInAt);
  // The match is called with a sound (draft 6b): on unless the player muted it.
  const sound = useSoundSettings();
  const closes = signupWindow.checkInClosesAt ? new Date(signupWindow.checkInClosesAt).getTime() : null;
  const firstAt = (tournament.settings?.schedule ?? [])
    .map((item) => new Date(item.at).getTime())
    .filter((time) => Number.isFinite(time) && time > now)
    .sort((a, b) => a - b)[0];
  const starters = registration.lineup.filter((p) => p.role === 'starter');
  const startersIn = starters.filter((p) => p.checkedInAt).length;
  const time = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }} data-testid="signup-checkin">
      {me && !checkedIn ? (
        <Box sx={{ p: { xs: 2.5, md: '24px 28px' }, borderRadius: radii.lg, bgcolor: color.paper2, border: `2px solid ${color.sideT}`, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2.5 }}>
          <ClockIcon size={40} color={color.sideT} aria-hidden />
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.625rem', fontWeight: 600 }}>{t('signup.checkIn.open')}</Typography>
            {closes && (
              <Typography sx={{ color: color.ink2 }}>
                {t('signup.checkIn.closesIn', { time: time.format(closes), left: countdown(closes, now) })}
              </Typography>
            )}
          </Box>
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
            sx={{ borderRadius: radii.pill, bgcolor: color.sideT, color: color.accentInk, fontWeight: 700, fontSize: '1.125rem', px: 5, py: 2, '&:hover': { bgcolor: color.sideT } }}
          >
            {t('signup.checkIn.imHere')}
          </Button>
        </Box>
      ) : (
        <Box sx={{ p: { xs: 2.5, md: '24px 28px' }, borderRadius: radii.lg, bgcolor: withAlpha(color.live, 0.14), border: `2px solid ${color.live}`, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2.5 }}>
          <CheckCircleIcon size={40} color={color.live} aria-hidden />
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.625rem', fontWeight: 600 }}>
              {me ? t('signup.checkIn.done') : t('signup.checkIn.teamTitle', { team: registration.teamName })}
            </Typography>
            <Typography sx={{ color: color.ink2 }}>{t('signup.checkIn.keepOpen')}</Typography>
            {me && (
              <Box
                component="button"
                type="button"
                onClick={sound.toggleMute}
                aria-pressed={!sound.isMuted}
                data-testid="signup-sound"
                sx={{
                  all: 'unset',
                  cursor: 'pointer',
                  mt: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.75,
                  px: 1.5,
                  py: 0.5,
                  borderRadius: radii.pill,
                  bgcolor: sound.isMuted ? color.paper3 : withAlpha(color.live, 0.18),
                  color: sound.isMuted ? color.ink2 : color.live,
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  '&:focus-visible': { outline: `2px solid ${color.focus}` },
                }}
              >
                {sound.isMuted ? <SpeakerSlashIcon size={14} aria-hidden /> : <SpeakerHighIcon size={14} aria-hidden />}
                {sound.isMuted ? t('signup.checkIn.soundOff') : t('signup.checkIn.soundOn')}
              </Box>
            )}
          </Box>
          {firstAt && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <Typography sx={{ fontSize: '0.8125rem', color: color.ink2 }}>{t('signup.checkIn.firstMatchIn')}</Typography>
              <Typography sx={{ fontFamily: fontDisplay, fontSize: '2.25rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }} data-testid="signup-countdown">
                {countdown(firstAt, now)}
              </Typography>
              <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>{time.format(firstAt)}</Typography>
            </Box>
          )}
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,1.5fr) minmax(0,1fr)' }, gap: 2, alignItems: 'start' }}>
        <Box sx={{ p: 3, borderRadius: radii.lg, bgcolor: color.paper2, border: `1px solid ${color.rule}`, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <TeamMark tag={registration.teamTag} name={registration.teamName} size={40} highlight />
            <Typography component="h2" sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600, flex: 1 }}>
              {registration.teamName}
            </Typography>
            <Typography sx={{ ...mono, fontSize: '0.875rem', color: startersIn === starters.length ? color.live : color.sideT }}>
              {t('signup.checkIn.count', { in: startersIn, total: starters.length })}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.75 }} aria-hidden>
            {starters.map((p) => (
              <Box key={p.steamId} sx={{ flex: 1, height: 8, borderRadius: 1, bgcolor: p.checkedInAt ? color.live : color.rule }} />
            ))}
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 1 }}>
            {registration.lineup.map((p) => (
              <PersonTile
                key={p.steamId}
                name={p.name}
                avatar={p.avatar}
                dim={!p.checkedInAt}
                note={p.steamId === steamId ? t('signup.checkIn.you') : p.role === 'sub' ? t('signup.sub') : undefined}
                badge={p.checkedInAt ? { tone: color.live, icon: <CheckIcon size={13} weight="bold" /> } : undefined}
              />
            ))}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography component="h2" sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}>
            {t('signup.checkIn.everyone')}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 1.25 }}>
            {registrations.map((reg) => {
              const regStarters = reg.lineup.filter((p) => p.role === 'starter');
              const inCount = regStarters.filter((p) => p.checkedInAt).length;
              const own = reg.teamId === registration.teamId;
              return (
                <Box key={reg.teamId} sx={{ p: 1.75, borderRadius: '18px', bgcolor: color.paper2, border: `1px solid ${own ? color.accent : color.rule}`, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                    <TeamMark tag={reg.teamTag} name={reg.teamName} highlight={own} />
                    <Typography sx={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reg.teamName}</Typography>
                    <Typography sx={{ ...mono, fontSize: '0.8125rem', color: inCount === regStarters.length ? color.live : color.sideT }}>
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
