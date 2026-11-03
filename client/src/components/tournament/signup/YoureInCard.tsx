/**
 * "You're in!" (Claude Design, Tournament page › Sign-up): what the team needs
 * to know before the tournament starts, each line from the tournament's
 * settings. The owner and captains get the same as a notice.
 */
import { Box, Button, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Tournament } from '../../../types';
import type { Registration, SignupWindow } from '../../../hooks/useTournamentSignup';
import { fmtTime, fmtWeekdayTime } from '../../../utils/time';
import { fontDisplay, mono, radii, tokens } from '../../../theme/tokens';

const { color } = tokens;

export function YoureInCard({
  tournament,
  window: win,
  registration,
  canManage,
}: {
  tournament: Tournament;
  window: SignupWindow | null;
  registration: Registration;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const settings = tournament.settings as
    | {
        fullTeamMinutes?: number;
        checkInEachMatch?: boolean;
        matchTimes?: { mode?: string; vetoLeadMinutes?: number };
      }
    | undefined;
  const size =
    registration.lineup.filter((p) => p.role === 'starter').length || tournament.teamSize || 5;
  const full = typeof settings?.fullTeamMinutes === 'number' ? settings.fullTeamMinutes : 10;
  const lead =
    settings?.matchTimes?.mode === 'times' ? (settings.matchTimes.vetoLeadMinutes ?? 5) : 0;
  const items: Array<[string, string]> = [];
  if (win?.checkInOpensAt && win.checkInClosesAt) {
    items.push([
      t('signup.youreIn.checkIn', {
        when: fmtWeekdayTime(win.checkInOpensAt),
        to: fmtTime(win.checkInClosesAt),
      }),
      win.captainCheckIn !== false
        ? t('signup.youreIn.checkInBodyCaptains')
        : t('signup.youreIn.checkInBody'),
    ]);
    items.push([t('signup.youreIn.subs'), t('signup.youreIn.subsBody')]);
    items.push([t('signup.youreIn.replaced'), t('signup.youreIn.replacedBody')]);
  }
  if (settings?.checkInEachMatch === true) {
    items.push([t('signup.youreIn.eachMatch'), t('signup.youreIn.eachMatchBody')]);
  }
  if (full > 0) {
    items.push([
      t('signup.youreIn.fullTeam', { count: full }),
      t('signup.youreIn.fullTeamBody', { count: full, size }),
    ]);
  }
  items.push([
    t('signup.youreIn.ready'),
    lead > 0 ? t('signup.youreIn.readyBodyVeto', { count: lead }) : t('signup.youreIn.readyBody'),
  ]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-testid="signup-youre-in">
      <Box
        sx={{
          borderRadius: '20px',
          border: `2px solid ${color.live}`,
          bgcolor: color.paper2,
          p: { xs: 2.5, sm: 3 },
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
        }}
      >
        <Typography
          sx={{
            ...mono,
            fontSize: 12,
            letterSpacing: 1.5,
            color: color.live,
            textTransform: 'uppercase',
          }}
        >
          {t('signup.youreIn.eyebrow', { team: registration.teamName })}
        </Typography>
        <Typography component="h2" sx={{ fontFamily: fontDisplay, fontSize: 28, fontWeight: 700 }}>
          {t('signup.youreIn.title')}
        </Typography>
        <Typography sx={{ color: color.ink2, lineHeight: 1.5 }}>
          {t('signup.youreIn.body')}
        </Typography>
        {canManage && (
          <Box sx={{ mt: 0.5 }}>
            <Button
              component={RouterLink}
              to={`/tournament/${tournament.id}/signup?edit=1`}
              variant="contained"
              sx={{ minHeight: 44, borderRadius: radii.pill }}
            >
              {t('signup.youreIn.openLineup')}
            </Button>
          </Box>
        )}
      </Box>
      <Box
        sx={{
          borderRadius: '18px',
          bgcolor: color.paper2,
          border: `1px solid ${color.rule}`,
          p: { xs: 2, sm: 2.75 },
        }}
      >
        <Typography component="h3" sx={{ fontWeight: 600, fontSize: 18, mb: 1 }}>
          {t('signup.youreIn.listTitle')}
        </Typography>
        <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {items.map(([title, body], i) => (
            <Box
              component="li"
              key={title}
              sx={{
                display: 'flex',
                gap: 1.75,
                py: 1.75,
                borderTop: i ? `1px solid ${color.rule}` : 'none',
              }}
            >
              <Box
                component="span"
                aria-hidden
                sx={{
                  flex: 'none',
                  width: 28,
                  height: 28,
                  borderRadius: '999px',
                  bgcolor: color.paper3,
                  color: color.accent,
                  ...mono,
                  fontSize: 13,
                  fontWeight: 600,
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                {i + 1}
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
                <Typography sx={{ fontWeight: 600 }}>{title}</Typography>
                <Typography variant="body2" sx={{ color: color.ink2, lineHeight: 1.45 }}>
                  {body}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
