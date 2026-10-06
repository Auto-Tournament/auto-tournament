import { useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Dialog, IconButton, Link, Typography } from '@mui/material';
import {
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  PlayCircleIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { Tournament } from '../../../types';
import type { Registration, SignupWindow } from '../../../hooks/useTournamentSignup';
import { Face, PersonTile, TeamMark } from './PlayerFace';
import { tokens, fontDisplay, mono, radii } from '../../../theme/tokens';

const { color } = tokens;

function Cell({ icon, tone, label, value, first, valueTone }: { icon: ReactNode; tone: string; label: string; value: string; first?: boolean; valueTone?: string }) {
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.75,
        alignItems: 'center',
        minWidth: 0,
        ...(!first && { pl: { sm: 2.75 }, borderLeft: { sm: `1px solid ${color.rule}` } }),
      }}
    >
      <Box sx={{ color: tone, display: 'flex', flex: 'none' }} aria-hidden>
        {icon}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>{label}</Typography>
        <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.0625rem', fontWeight: 600, color: valueTone ?? color.ink }}>
          {value}
        </Typography>
      </Box>
    </Box>
  );
}

/** Teams by lineup rating, best first, the viewer's own ringed. */
export function TeamsLadder({ registrations, ownTeamId }: { registrations: Registration[]; ownTeamId: string | null }) {
  const { t } = useTranslation();
  const ranked = [...registrations].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const top = Math.max(...ranked.map((r) => r.rating ?? 0), 1);
  const bottom = Math.min(...ranked.map((r) => r.rating ?? top));
  const position = ranked.findIndex((r) => r.teamId === ownTeamId);

  return (
    <Box data-testid="signup-ladder" sx={{ p: 2.25, borderRadius: radii.lg, bgcolor: color.paper2, border: `1px solid ${color.rule}`, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', px: 0.75, pb: 0.75 }}>
        <Typography component="h2" sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}>
          {t('signup.ladder.title')}
        </Typography>
        {position >= 0 && (
          <Typography sx={{ fontSize: '0.875rem', color: color.accent }}>
            {t('signup.ladder.yourPlace', { place: position + 1, count: ranked.length })}
          </Typography>
        )}
      </Box>
      {ranked.map((reg, index) => {
        const own = reg.teamId === ownTeamId;
        const width = top === bottom ? 100 : 30 + (((reg.rating ?? bottom) - bottom) / (top - bottom)) * 70;
        return (
          <Box
            key={reg.teamId}
            sx={{
              display: 'grid',
              gridTemplateColumns: '28px 36px minmax(0,1fr) auto',
              gap: 1.5,
              alignItems: 'center',
              p: '12px 14px',
              borderRadius: '14px',
              ...(own && { bgcolor: color.paper3, outline: `1px solid ${color.accent}` }),
            }}
          >
            <Typography sx={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: '1.125rem', color: own ? color.accent : color.muted }}>
              {index + 1}
            </Typography>
            <TeamMark tag={reg.teamTag} name={reg.teamName} highlight={own} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0 }}>
              <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{reg.teamName}</Typography>
              <Box sx={{ display: 'flex' }}>
                {reg.lineup
                  .filter((p) => p.role === 'starter')
                  .map((p, i) => (
                    <Box key={p.steamId} sx={{ ml: i === 0 ? 0 : '-8px' }}>
                      <Face name={p.name} avatar={p.avatar} size={26} />
                    </Box>
                  ))}
              </Box>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.75 }}>
              <Typography sx={{ ...mono, fontSize: '0.9375rem' }}>{reg.rating ?? '—'}</Typography>
              <Box sx={{ width: 90, height: 6, borderRadius: 3, bgcolor: color.rule, overflow: 'hidden' }}>
                <Box sx={{ height: '100%', width: `${width}%`, bgcolor: own ? color.accent : color.muted }} />
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * The signed-up team's panel before the day (boards 5 and 5b): the to-do bar,
 * the lineup as faces with Change and Withdraw, and the teams by rating.
 * Problems collapse into one yellow button that opens the list.
 */
export function RegisteredPanel({
  tournament,
  window,
  registration,
  registrations,
  canManage,
  onWithdraw,
}: {
  tournament: Tournament;
  window: SignupWindow | null;
  registration: Registration;
  registrations: Registration[];
  canManage: boolean;
  onWithdraw: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [fixOpen, setFixOpen] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const problems = registration.lineup.flatMap((p) => p.problems.map((problem) => ({ player: p, problem })));
  const dayAndTime = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const firstAt = (tournament.settings?.schedule ?? [])
    .map((item) => new Date(item.at).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }} data-testid="signup-registered">
      <Box
        sx={{
          p: { xs: 2, md: '20px 24px' },
          borderRadius: radii.lg,
          bgcolor: color.paper2,
          border: `1px solid ${problems.length ? color.sideT : color.live}`,
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0,1fr)', md: `repeat(4, minmax(0,1fr))${problems.length ? ' auto' : ''}` },
          alignItems: 'center',
          gap: 2.5,
        }}
      >
        <Cell first icon={<CheckCircleIcon size={22} />} tone={color.live} label={registration.teamName} value={t('signup.todo.signedUp')} valueTone={color.live} />
        {problems.length > 0 ? (
          <Cell icon={<WarningIcon size={22} />} tone={color.sideT} label={t('signup.todo.beforeTheDay')} value={t('signup.todo.toFix', { count: problems.length })} valueTone={color.sideT} />
        ) : (
          <Cell icon={<CheckCircleIcon size={22} />} tone={color.live} label={t('signup.todo.lineup')} value={t('signup.todo.allReady')} valueTone={color.live} />
        )}
        <Cell
          icon={<ClockIcon size={22} />}
          tone={color.muted}
          label={t('signup.keyDates.checkIn')}
          value={window?.checkInOpensAt ? dayAndTime.format(new Date(window.checkInOpensAt)) : t('signup.todo.notSet')}
        />
        <Cell
          icon={<PlayCircleIcon size={22} />}
          tone={color.muted}
          label={t('overviewPage.keyDates.starts')}
          value={firstAt ? dayAndTime.format(firstAt) : t('signup.todo.notSet')}
        />
        {problems.length > 0 && (
          <Button
            variant="contained"
            onClick={() => setFixOpen(true)}
            data-testid="signup-show-fixes"
            sx={{ borderRadius: radii.pill, bgcolor: color.sideT, color: color.accentInk, fontWeight: 600, px: 3, py: 1.5, whiteSpace: 'nowrap', '&:hover': { bgcolor: color.sideT } }}
          >
            {t('signup.todo.showFixes')}
          </Button>
        )}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,1.4fr) minmax(0,1fr)' }, gap: 2, alignItems: 'start' }}>
        <Box sx={{ p: 3, borderRadius: radii.lg, bgcolor: color.paper2, border: `1px solid ${color.rule}`, display: 'flex', flexDirection: 'column', gap: 2.75 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <TeamMark tag={registration.teamTag} name={registration.teamName} size={40} highlight />
            <Typography component="h2" sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600, flex: 1 }}>
              {t('signup.yourLineup')}
            </Typography>
            {canManage && (
              <>
                <Link component={RouterLink} to={`/tournament/${tournament.id}/signup?edit=1`} sx={{ fontSize: '0.875rem', color: color.ink2 }}>
                  {t('signup.change')}
                </Link>
                {tournament.status === 'setup' && (
                  <Link component="button" onClick={() => setConfirmWithdraw(true)} sx={{ fontSize: '0.875rem', color: color.ban }}>
                    {t('signup.withdraw')}
                  </Link>
                )}
              </>
            )}
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 1 }}>
            {registration.lineup.map((p) => (
              <PersonTile
                key={p.steamId}
                name={p.name}
                avatar={p.avatar}
                note={p.problems.length ? t(`signup.problemShort.${p.problems[0]}`) : p.role === 'sub' ? t('signup.sub') : undefined}
                noteTone={p.problems.length ? color.sideT : undefined}
                badge={
                  p.problems.length
                    ? { tone: color.sideT, icon: <WarningIcon size={13} weight="bold" /> }
                    : { tone: color.live, icon: <CheckIcon size={13} weight="bold" /> }
                }
              />
            ))}
          </Box>
        </Box>
        <TeamsLadder registrations={registrations} ownTeamId={registration.teamId} />
      </Box>

      <Dialog open={fixOpen} onClose={() => setFixOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: radii.lg, bgcolor: color.paper2, backgroundImage: 'none' } }}>
        <Box sx={{ p: 3.5, display: 'flex', flexDirection: 'column', gap: 1 }} data-testid="signup-fix-list">
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}>
            <Typography component="h2" sx={{ fontFamily: fontDisplay, fontSize: '1.5rem', fontWeight: 600 }}>
              {t('signup.todo.toFix', { count: problems.length })}
            </Typography>
            <IconButton aria-label={t('common.close')} onClick={() => setFixOpen(false)}>
              <XIcon size={18} />
            </IconButton>
          </Box>
          {registration.lineup.map((p) => (
            <Box key={p.steamId} sx={{ display: 'grid', gridTemplateColumns: '22px 44px minmax(0,1fr)', gap: 1.75, alignItems: 'center', py: 1.75, borderBottom: `1px solid ${color.rule}` }}>
              <Box sx={{ color: p.problems.length ? color.sideT : color.live, display: 'flex' }} aria-hidden>
                {p.problems.length ? <WarningIcon size={22} /> : <CheckCircleIcon size={22} />}
              </Box>
              <Face name={p.name} avatar={p.avatar} size={44} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600 }}>{p.name}</Typography>
                <Typography sx={{ fontSize: '0.875rem', color: p.problems.length ? color.ink2 : color.muted }}>
                  {p.problems.length ? p.problems.map((problem) => t(`signup.problem.${problem}`)).join(' · ') : t('signup.ready')}
                </Typography>
              </Box>
            </Box>
          ))}
          <Typography sx={{ fontSize: '0.8125rem', color: color.muted, pt: 1.25 }}>{t('signup.todo.fixNote')}</Typography>
        </Box>
      </Dialog>

      <Dialog open={confirmWithdraw} onClose={() => setConfirmWithdraw(false)} PaperProps={{ sx: { borderRadius: radii.lg, bgcolor: color.paper2, backgroundImage: 'none' } }}>
        <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 420 }}>
          <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}>
            {t('signup.withdrawTitle', { team: registration.teamName })}
          </Typography>
          <Typography sx={{ color: color.ink2 }}>{t('signup.withdrawBody')}</Typography>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button onClick={() => setConfirmWithdraw(false)}>{t('common.cancel')}</Button>
            <Button
              color="error"
              variant="contained"
              data-testid="signup-withdraw-confirm"
              onClick={() => {
                setConfirmWithdraw(false);
                void onWithdraw();
              }}
            >
              {t('signup.withdraw')}
            </Button>
          </Box>
        </Box>
      </Dialog>
    </Box>
  );
}
