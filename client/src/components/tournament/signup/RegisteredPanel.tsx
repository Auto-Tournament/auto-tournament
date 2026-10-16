import { useState, type ReactNode } from 'react';
import { fmtDayTime, fmtTime } from '../../../utils/time';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Dialog, IconButton, Link, Typography } from '@mui/material';
import Alert from '@mui/material/Alert';
import { CheckCircleIcon, WarningIcon, XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { Tournament } from '../../../types';
import {
  remindLineupPlayer,
  type Registration,
  type SignupWindow,
} from '../../../hooks/useTournamentSignup';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { Face, TeamMark } from './PlayerFace';
import { InfoTile, PlayerAvatar, StatusHero } from '../ui/draftUi';
import { tokens, fontDisplay, mono, radii } from '../../../theme/tokens';
import { panelSx, panelBorderSx, dialogPaperSx } from '../../../components/common/ui';

const { color } = tokens;

/** Teams by lineup rating, best first, the viewer's own ringed. */
export function TeamsLadder({
  registrations,
  ownTeamId,
}: {
  registrations: Registration[];
  ownTeamId: string | null;
}) {
  const { t } = useTranslation();
  const ranked = [...registrations].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const top = Math.max(...ranked.map((r) => r.rating ?? 0), 1);
  const bottom = Math.min(...ranked.map((r) => r.rating ?? top));
  const position = ranked.findIndex((r) => r.teamId === ownTeamId);

  return (
    <Box
      data-testid="signup-ladder"
      sx={{
        ...panelSx,
        ...panelBorderSx,
        p: 2.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          px: 0.75,
          pb: 0.75,
        }}
      >
        <Typography
          component="h2"
          sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}
        >
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
        const width =
          top === bottom ? 100 : 30 + (((reg.rating ?? bottom) - bottom) / (top - bottom)) * 70;
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
            <Typography
              sx={{
                fontFamily: fontDisplay,
                fontWeight: 700,
                fontSize: '1.125rem',
                color: own ? color.accent : color.muted,
              }}
            >
              {index + 1}
            </Typography>
            <TeamMark tag={reg.teamTag} name={reg.teamName} highlight={own} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0 }}>
              <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                {reg.teamName}
              </Typography>
              <Box sx={{ display: 'flex' }}>
                {reg.lineup
                  .filter((p) => p.role === 'starter')
                  .map((p, i) => (
                    <Box key={p.steamId} sx={{ ml: i === 0 ? 0 : '-8px' }}>
                      <Face playerId={p.steamId} name={p.name} avatar={p.avatar} size={26} />
                    </Box>
                  ))}
              </Box>
            </Box>
            <Box
              sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.75 }}
            >
              <Typography sx={{ ...mono, fontSize: '0.9375rem' }}>{reg.rating ?? '—'}</Typography>
              <Box
                sx={{
                  width: 90,
                  height: 6,
                  borderRadius: 3,
                  bgcolor: color.rule,
                  overflow: 'hidden',
                }}
              >
                <Box
                  sx={{
                    height: '100%',
                    width: `${width}%`,
                    bgcolor: own ? color.accent : color.muted,
                  }}
                />
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
  const { t } = useTranslation();
  const [fixOpen, setFixOpen] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const { showSuccess, showError } = useSnackbar();
  const remind = async (steamId: string) => {
    try {
      await remindLineupPlayer(tournament.id, registration.teamId, steamId);
      showSuccess(t('signup.reminded'));
    } catch (error) {
      showError((error as Error).message);
    }
  };
  const problems = registration.lineup.flatMap((p) =>
    p.problems.map((problem) => ({ player: p, problem }))
  );
  const firstAt = (tournament.settings?.schedule ?? [])
    .map((item) => new Date(item.at).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }} data-testid="signup-registered">
      {registration.lineupGapDeadline && (
        <Alert
          severity="warning"
          data-testid="signup-lineup-gap"
          action={
            canManage ? (
              <Button
                color="inherit"
                size="small"
                component={RouterLink}
                to={`/tournament/${tournament.id}/signup?edit=1`}
              >
                {t('signup.pickSub')}
              </Button>
            ) : undefined
          }
        >
          {t('signup.lineupGap', {
            time: fmtTime(registration.lineupGapDeadline),
          })}
        </Alert>
      )}
      {(() => {
        const starters = registration.lineup.filter((p) => p.role !== 'sub').length;
        const subs = registration.lineup.length - starters;
        const place =
          [...registrations]
            .sort((x, y) => x.registeredAt - y.registeredAt)
            .findIndex((r) => r.teamId === registration.teamId) + 1;
        const checkInAt = window?.checkInOpensAt ? new Date(window.checkInOpensAt) : null;
        const item = (children: ReactNode, warn = false) => (
          <Box
            component="li"
            sx={{
              px: 2,
              py: 1.5,
              borderRadius: radii.md,
              bgcolor: color.paper3,
              border: `2px solid ${warn ? color.warning : 'transparent'}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            {children}
          </Box>
        );
        return (
          <StatusHero
            eyebrow={t('preStart.signedUpEyebrow', { team: registration.teamName })}
            eyebrowColor={color.live}
            ring={problems.length ? color.warning : color.rule}
            title={
              problems.length
                ? t('preStart.inToFix', { count: problems.length })
                : t('preStart.inTitle')
            }
            body={
              problems.length
                ? checkInAt
                  ? t('preStart.fixBefore', { when: fmtDayTime(checkInAt) })
                  : t('signup.todo.fixNote')
                : checkInAt
                  ? t('preStart.checkInOn', { when: fmtDayTime(checkInAt) })
                  : t('preStart.allSet')
            }
            side={
              <>
                <InfoTile
                  label={checkInAt ? t('preStart.checkInOpens') : t('overviewPage.keyDates.starts')}
                  value={
                    checkInAt
                      ? fmtDayTime(checkInAt)
                      : firstAt
                        ? fmtDayTime(firstAt)
                        : t('signup.todo.notSet')
                  }
                  note={
                    window?.checkInClosesAt ? `– ${fmtTime(window.checkInClosesAt)}` : undefined
                  }
                />
                {canManage && (
                  <Button
                    component={RouterLink}
                    to={`/tournament/${tournament.id}/signup?edit=1`}
                    variant="contained"
                    sx={{ minHeight: 56, borderRadius: radii.pill, fontWeight: 700 }}
                  >
                    {t('preStart.openLineup')}
                  </Button>
                )}
              </>
            }
          >
            <Box
              component="ol"
              aria-label={t('preStart.yourSignup')}
              sx={{
                listStyle: 'none',
                m: 0,
                p: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              {item(
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                  <span>
                    {t('signup.todo.signedUp')}
                    {place > 0 && window?.maxTeams
                      ? ` · ${t('preStart.spotOf', { place, max: window.maxTeams })}`
                      : ''}
                  </span>
                  <Box component="span" sx={{ color: color.live, fontWeight: 700 }}>
                    ✓ {t('signup.done')}
                  </Box>
                </Box>
              )}
              {item(
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 1,
                    alignItems: 'center',
                  }}
                >
                  <span>{t('preStart.lineupCount', { starters, subs })}</span>
                  {canManage && (
                    <Link
                      component={RouterLink}
                      to={`/tournament/${tournament.id}/signup?edit=1`}
                      sx={{ fontWeight: 600 }}
                    >
                      {t('signup.change')}
                    </Link>
                  )}
                </Box>
              )}
              {problems.length > 0 &&
                item(
                  <>
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 1,
                        alignItems: 'center',
                      }}
                    >
                      <Box component="span" sx={{ fontWeight: 600 }}>
                        {t('signup.todo.beforeTheDay')} ·{' '}
                        {t('signup.todo.toFix', { count: problems.length })}
                      </Box>
                      <Box
                        component="span"
                        sx={{
                          px: 1.5,
                          py: 0.5,
                          borderRadius: radii.pill,
                          bgcolor: color.warning,
                          color: color.accentInk,
                          fontSize: '0.8125rem',
                          fontWeight: 600,
                        }}
                      >
                        {t('preStart.fixBeforeCheckIn')}
                      </Box>
                    </Box>
                    {problems.map(({ player, problem }) => (
                      <Box
                        key={`${player.steamId}-${problem}`}
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 1,
                          alignItems: 'center',
                          fontSize: '0.9375rem',
                        }}
                      >
                        <span>
                          <Box component="span" sx={{ color: color.ink2 }}>
                            {player.name}
                          </Box>{' '}
                          · {t(`signup.problem.${problem}`)}
                        </span>
                        {canManage && (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => void remind(player.steamId)}
                            data-testid="signup-fix-remind"
                            sx={{ minHeight: 36, borderRadius: radii.pill }}
                          >
                            {t('signup.remind')}
                          </Button>
                        )}
                      </Box>
                    ))}
                  </>,
                  true
                )}
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {registration.lineup.map((p) => (
                <Box key={p.steamId} title={p.name} sx={{ position: 'relative' }}>
                  <PlayerAvatar
                    id={p.steamId}
                    name={p.name}
                    avatar={p.avatar}
                    size={36}
                    label
                    sx={{
                      outline: `2px solid ${p.problems.length ? color.warning : color.live}`,
                      outlineOffset: 2,
                    }}
                  />
                </Box>
              ))}
            </Box>
          </StatusHero>
        );
      })()}

      {canManage && tournament.status === 'setup' && (
        <Box
          component="section"
          aria-label={t('preStart.leave')}
          sx={{
            borderTop: `1px solid ${color.rule}`,
            pt: 2.5,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1.5,
            alignItems: 'center',
            justifyContent: 'space-between',
            order: 99,
          }}
        >
          <Typography sx={{ fontSize: '0.875rem', color: color.muted }}>
            {t('preStart.withdrawHint')}
          </Typography>
          <Button
            variant="outlined"
            onClick={() => setConfirmWithdraw(true)}
            sx={{
              minHeight: 44,
              borderRadius: radii.pill,
              color: color.ban,
              borderColor: color.rule,
            }}
          >
            {t('signup.withdraw')} {registration.teamName}
          </Button>
        </Box>
      )}

      <Dialog
        open={fixOpen}
        onClose={() => setFixOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: dialogPaperSx }}
      >
        <Box
          sx={{ p: 3.5, display: 'flex', flexDirection: 'column', gap: 1 }}
          data-testid="signup-fix-list"
        >
          <Box
            sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}
          >
            <Typography
              component="h2"
              sx={{ fontFamily: fontDisplay, fontSize: '1.5rem', fontWeight: 600 }}
            >
              {t('signup.todo.toFix', { count: problems.length })}
            </Typography>
            <IconButton aria-label={t('common.close')} onClick={() => setFixOpen(false)}>
              <XIcon size={18} />
            </IconButton>
          </Box>
          {registration.lineup.map((p) => (
            <Box
              key={p.steamId}
              sx={{
                display: 'grid',
                gridTemplateColumns: '22px 44px minmax(0,1fr) auto',
                gap: 1.75,
                alignItems: 'center',
                py: 1.75,
                borderBottom: `1px solid ${color.rule}`,
              }}
            >
              <Box
                sx={{ color: p.problems.length ? color.sideT : color.live, display: 'flex' }}
                aria-hidden
              >
                {p.problems.length ? <WarningIcon size={22} /> : <CheckCircleIcon size={22} />}
              </Box>
              <Face playerId={p.steamId} name={p.name} avatar={p.avatar} size={44} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600 }}>{p.name}</Typography>
                <Typography
                  sx={{ fontSize: '0.875rem', color: p.problems.length ? color.ink2 : color.muted }}
                >
                  {p.problems.length
                    ? p.problems.map((problem) => t(`signup.problem.${problem}`)).join(' · ')
                    : t('signup.ready')}
                </Typography>
              </Box>
              {p.problems.length > 0 && canManage ? (
                <Button
                  size="small"
                  onClick={() => void remind(p.steamId)}
                  data-testid="signup-fix-remind"
                  sx={{ borderRadius: radii.pill, bgcolor: color.paper3, color: color.ink, px: 2 }}
                >
                  {t('signup.remind')}
                </Button>
              ) : (
                <Typography sx={{ fontSize: '0.8125rem', color: color.live, fontWeight: 600 }}>
                  {p.problems.length ? '' : t('signup.done')}
                </Typography>
              )}
            </Box>
          ))}
          <Typography sx={{ fontSize: '0.8125rem', color: color.muted, pt: 1.25 }}>
            {t('signup.todo.fixNote')}
          </Typography>
        </Box>
      </Dialog>

      <Dialog
        open={confirmWithdraw}
        onClose={() => setConfirmWithdraw(false)}
        PaperProps={{ sx: dialogPaperSx }}
      >
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
