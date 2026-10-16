import { useEffect, useMemo, useState } from 'react';
import { fmtTime, fmtWeekdayTime } from '../utils/time';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Checkbox, Link, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useTournamentPage } from '../components/tournament/page/tournamentPageContext';
import {
  remindLineupPlayer,
  useTournamentSignup,
  viewerRegistration,
} from '../hooks/useTournamentSignup';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useSetupGames } from '../components/tournament/setup/games';
import {
  AvatarStack,
  PlayerAvatar,
  TeamLogo,
  eyebrowSx,
  h2Sx,
  panel,
} from '../components/tournament/ui/draftUi';
import { TabLoading } from '../components/tournament/page/TabState';
import { api } from '../utils/api';
import { paths, tournamentTabPath } from '../paths';
import { tokens, fontDisplay, mono, radii } from '../theme/tokens';

const { color } = tokens;
const MAX_SUBS = 2;

type Slot = 'starter' | 'sub' | 'out';

/**
 * Signing a team up (boards 2 and 3): pick the team if you can sign up more
 * than one, pick who plays (starters, up to two subs), then review and send.
 * With `?edit=1` it changes the lineup of a team that is already in.
 */
export default function TournamentSignupTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editing = params.get('edit') === '1';
  const { tournament } = useTournamentPage();
  const signup = useTournamentSignup(tournament.id);
  const teamSize = tournament.teamSize ?? 5;
  const existing = viewerRegistration(signup);
  const { games } = useSetupGames();
  const gameName =
    games.find((entry) => entry.id === (tournament.game || 'cs2'))?.name ??
    tournament.game ??
    'CS2';
  const { showSuccess, showError } = useSnackbar();
  const remind = async (teamId: string, steamId: string) => {
    try {
      await remindLineupPlayer(tournament.id, teamId, steamId);
      showSuccess(t('signup.reminded'));
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const [pickedTeamId, setPickedTeamId] = useState<string | null>(null);
  const [slots, setSlots] = useState<Record<string, Slot> | null>(null);
  const [step, setStep] = useState<'lineup' | 'review'>('lineup');
  const [rulesOk, setRulesOk] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // A new step starts at its top, not where the last one was scrolled to.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  const teams = signup.eligibleTeams;
  const teamId = pickedTeamId ?? (editing ? existing?.teamId : null) ?? teams[0]?.id ?? null;
  const team = teams.find((tm) => tm.id === teamId) ?? null;

  // The slots start from the saved lineup when editing, else the first players as starters.
  const initialSlots = useMemo(() => {
    if (!team) return {};
    const saved = editing && existing?.teamId === team.id ? existing.lineup : null;
    const map: Record<string, Slot> = {};
    team.members.forEach((m, i) => {
      const s = saved?.find((p) => p.steamId === m.steamId);
      map[m.steamId] = s ? s.role : saved ? 'out' : i < teamSize ? 'starter' : 'out';
    });
    return map;
  }, [team, editing, existing, teamSize]);
  const current = slots ?? initialSlots;

  if (signup.loading) return <TabLoading label={t('overviewPage.loading')} />;

  const header = (title: string, stepsShown: boolean) => (
    <Box component="header" sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Link
        component={RouterLink}
        to={tournamentTabPath(tournament.id)}
        sx={{ fontSize: '0.875rem', color: color.ink2, alignSelf: 'flex-start' }}
      >
        ← {tournament.name}
      </Link>
      <Typography
        id="tournament-title"
        component="h1"
        sx={{
          m: 0,
          fontFamily: fontDisplay,
          fontSize: { xs: '1.75rem', md: '2.25rem' },
          fontWeight: 700,
          lineHeight: 1.15,
        }}
      >
        {title}
      </Typography>
      {stepsShown && (
        <Box
          component="ol"
          aria-label={t('signup.stepsLabel')}
          sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', gap: 1, flexWrap: 'wrap' }}
        >
          {(['lineup', 'review'] as const).map((key, i) => (
            <Box
              key={key}
              component="li"
              aria-current={step === key ? 'step' : undefined}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
                px: 1.75,
                py: 0.75,
                borderRadius: radii.pill,
                fontSize: '0.875rem',
                fontWeight: 600,
                bgcolor: step === key ? color.accent : color.paper2,
                color: step === key ? color.accentInk : color.ink2,
              }}
            >
              <Box component="span" sx={mono}>
                {i + 1}
              </Box>
              {t(`signup.steps.${key}`)}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );

  if (!teams.length) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 880 }}>
        {header(t('signup.title'), false)}
        <Box
          component="section"
          aria-labelledby="signup-no-team-title"
          sx={{ ...panel, alignItems: 'flex-start' }}
          data-testid="signup-no-team"
        >
          <Typography id="signup-no-team-title" component="h2" sx={h2Sx}>
            {t('signup.noTeamTitle')}
          </Typography>
          <Typography sx={{ color: color.ink2 }}>{t('signup.noTeamBody')}</Typography>
          <Button component={RouterLink} to={paths.communityTeams} variant="outlined" size="small">
            {t('signup.goToTeams')}
          </Button>
        </Box>
      </Box>
    );
  }

  const starters = team?.members.filter((m) => current[m.steamId] === 'starter') ?? [];
  const subs = team?.members.filter((m) => current[m.steamId] === 'sub') ?? [];
  const missingAccount = [...starters, ...subs].filter((m) => !m.hasAccount);
  const rated = starters.filter((m) => m.rating !== null);
  const rating = rated.length
    ? Math.round(rated.reduce((s, m) => s + (m.rating ?? 0), 0) / rated.length)
    : null;
  const lineupOk = starters.length === teamSize && subs.length <= MAX_SUBS;
  const spotsLeft = signup.window?.maxTeams
    ? signup.window.maxTeams - tournament.teamIds.length
    : null;
  const checkInAt = signup.window?.checkInOpensAt ? new Date(signup.window.checkInOpensAt) : null;

  const setSlot = (steamId: string, slot: Slot) => setSlots({ ...current, [steamId]: slot });

  const send = async () => {
    if (!team) return;
    setSending(true);
    setError('');
    try {
      const body = {
        teamId: team.id,
        starters: starters.map((m) => m.steamId),
        subs: subs.map((m) => m.steamId),
      };
      if (editing) await api.put(`/api/tournament-signup/${tournament.id}/lineup`, body);
      else
        await api.post(`/api/tournament-signup/${tournament.id}/register`, {
          ...body,
          acceptRules: rulesOk,
        });
      navigate(tournamentTabPath(tournament.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const segBtn = (on: boolean) => ({
    all: 'unset' as const,
    cursor: 'pointer',
    px: 1.5,
    minHeight: 36,
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: radii.pill,
    fontSize: '0.875rem',
    fontWeight: 600,
    bgcolor: on ? color.rule : 'transparent',
    color: on ? color.ink : color.muted,
    '&:hover': { color: color.ink },
    '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
  });
  const problems = [...starters, ...subs].filter((m) => !m.hasAccount || m.hasGame === false);
  const changeUntil = checkInAt ? fmtWeekdayTime(checkInAt) : null;
  const checkInEnd = signup.window?.checkInClosesAt
    ? new Date(signup.window.checkInClosesAt)
    : null;
  const firstMatchAt = tournament.settings?.schedule?.[0]?.at
    ? new Date(tournament.settings.schedule[0].at)
    : null;
  const takenAfter = tournament.teamIds.length + (editing ? 0 : 1);

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 880 }}
      data-testid="signup-page"
    >
      {header(editing ? t('signup.editTitle') : t('signup.title'), !editing)}

      {step === 'lineup' ? (
        <>
          {teams.length > 1 && !editing && (
            <Box component="section" aria-labelledby="signup-which" sx={panel}>
              <Typography id="signup-which" component="h2" sx={h2Sx}>
                {t('signup.whichTeam')}
              </Typography>
              <Box
                role="radiogroup"
                aria-labelledby="signup-which"
                data-testid="signup-team-select"
                sx={{
                  display: 'grid',
                  gap: 1.5,
                  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 15rem), 1fr))',
                }}
              >
                {teams.map((tm) => {
                  const on = tm.id === teamId;
                  return (
                    <Box
                      key={tm.id}
                      component="button"
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => {
                        setPickedTeamId(tm.id);
                        setSlots(null);
                      }}
                      sx={{
                        all: 'unset',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        p: 2,
                        borderRadius: radii.md,
                        bgcolor: color.paper3,
                        border: `2px solid ${on ? color.accent : 'transparent'}`,
                        '&:hover': { borderColor: on ? color.accent : color.rule },
                        '&:focus-visible': {
                          outline: `2px solid ${color.focus}`,
                          outlineOffset: 2,
                        },
                      }}
                    >
                      <TeamLogo team={{ id: tm.id, name: tm.name, tag: tm.tag }} size="md" />
                      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <Typography
                          component="span"
                          sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}
                        >
                          {tm.name}
                        </Typography>
                        <Typography
                          component="span"
                          sx={{ fontSize: '0.8125rem', color: color.ink2 }}
                        >
                          {t(`signup.role.${tm.role}`)} ·{' '}
                          {t('signup.playerCount', { count: tm.members.length })}
                        </Typography>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}

          <Box component="section" aria-labelledby="signup-who" sx={panel}>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 1,
              }}
            >
              <Typography id="signup-who" component="h2" sx={h2Sx}>
                {t('signup.whoPlays')}
              </Typography>
              <Typography component="span" sx={{ fontSize: '0.875rem', color: color.ink2 }}>
                {t('signup.whoPlaysHint', { count: teamSize, subs: MAX_SUBS })}
              </Typography>
            </Box>
            {changeUntil && (
              <Typography sx={{ fontSize: '0.875rem', color: color.ink2 }}>
                {t('signup.changeUntil', { when: changeUntil })}
              </Typography>
            )}
            <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {team?.members.map((m) => {
                const problem = !m.hasAccount || m.hasGame === false;
                const tag = m.owner
                  ? t('signup.ownerTag')
                  : m.captain
                    ? t('signup.captainTag')
                    : '';
                return (
                  <Box
                    component="li"
                    key={m.steamId}
                    data-testid="signup-member"
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: '40px minmax(0,1fr)',
                        sm: '40px minmax(0,1fr) auto',
                      },
                      gap: 1.5,
                      alignItems: 'center',
                      py: 1.25,
                      borderTop: `1px solid ${color.rule}`,
                    }}
                  >
                    <PlayerAvatar name={m.name} avatar={m.avatar} size={40} />
                    <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <Typography
                        component="span"
                        sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
                      >
                        {m.name}{' '}
                        {tag && (
                          <Box
                            component="span"
                            sx={{ fontWeight: 400, fontSize: '0.8125rem', color: color.muted }}
                          >
                            {tag}
                          </Box>
                        )}
                      </Typography>
                      <Typography
                        component="span"
                        data-testid="signup-member-checks"
                        sx={{
                          fontSize: '0.8125rem',
                          color: problem ? color.warning : color.muted,
                          display: 'flex',
                          gap: 0.75,
                          flexWrap: 'wrap',
                          alignItems: 'baseline',
                        }}
                      >
                        <span>
                          {[
                            m.hasAccount
                              ? `${t('signup.check.steamShort')} ✓`
                              : t('signup.problem.noAccount'),
                            m.hasAccount && m.hasGame === true ? `${gameName} ✓` : null,
                            m.hasAccount && m.hasGame === false
                              ? t('signup.check.noGame', { game: gameName })
                              : null,
                            m.hasAccount && m.rating !== null && !problem
                              ? t('signup.rating', { rating: m.rating })
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        {problem && team && (
                          <Link
                            component="button"
                            type="button"
                            onClick={() => void remind(team.id, m.steamId)}
                            sx={{ fontSize: 'inherit', color: color.accent }}
                            data-testid="signup-remind"
                          >
                            {t('signup.remind')}
                          </Link>
                        )}
                      </Typography>
                    </Box>
                    <Box
                      role="radiogroup"
                      aria-label={t('signup.slotFor', { name: m.name })}
                      sx={{
                        gridColumn: { xs: '1 / -1', sm: 'auto' },
                        display: 'inline-flex',
                        gap: 0.5,
                        p: 0.5,
                        borderRadius: radii.pill,
                        bgcolor: color.paper3,
                        justifySelf: { xs: 'start', sm: 'end' },
                      }}
                    >
                      {(['starter', 'sub', 'out'] as const).map((slot) => {
                        const on = (current[m.steamId] ?? 'out') === slot;
                        return (
                          <Box
                            key={slot}
                            component="button"
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => setSlot(m.steamId, slot)}
                            sx={segBtn(on)}
                          >
                            {t(`signup.${slot}`)}
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>
                );
              })}
            </Box>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                gap: 1,
                pt: 1.5,
                borderTop: `1px solid ${color.rule}`,
              }}
            >
              <Typography component="span" sx={{ color: lineupOk ? color.ink : color.ink2 }}>
                {t('signup.counts', {
                  starters: starters.length,
                  teamSize,
                  subs: subs.length,
                  maxSubs: MAX_SUBS,
                })}
              </Typography>
              <Typography component="span" sx={{ ...mono }}>
                {t('signup.lineupRatingValue', { rating: rating ?? '—' })}
              </Typography>
            </Box>
            {problems.length > 0 && (
              <Typography sx={{ fontSize: '0.875rem', color: color.warning }}>
                {missingAccount.length > 0
                  ? t('signup.missingAccounts', {
                      names: missingAccount.map((m) => m.name).join(', '),
                    })
                  : t('signup.missingGame', {
                      names: problems.map((m) => m.name).join(', '),
                      game: gameName,
                    })}{' '}
                {t('signup.fixBeforeCheckIn')}
              </Typography>
            )}
            {error && <Alert severity="error">{error}</Alert>}
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Link
                component={RouterLink}
                to={tournamentTabPath(tournament.id)}
                sx={{ color: color.ink2 }}
              >
                {t('common.cancel')}
              </Link>
              {editing ? (
                <Button
                  variant="contained"
                  disabled={!lineupOk || sending}
                  onClick={() => void send()}
                  data-testid="signup-save-lineup"
                >
                  {t('signup.saveLineup')}
                </Button>
              ) : (
                <Button
                  variant="contained"
                  disabled={!lineupOk}
                  onClick={() => setStep('review')}
                  data-testid="signup-next"
                >
                  {t('signup.nextReview')}
                </Button>
              )}
            </Box>
          </Box>
        </>
      ) : (
        team && (
          <Box component="section" aria-labelledby="signup-send-title" sx={panel}>
            <Typography id="signup-send-title" component="h2" sx={h2Sx}>
              {t('signup.readyToSend')}
            </Typography>
            <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {[
                [
                  spotsLeft === 1 ? t('signup.next.lastSpot') : t('signup.next.takesSpot'),
                  signup.window?.maxTeams
                    ? t('signup.next.spotOf', { n: takenAfter, max: signup.window.maxTeams })
                    : '',
                ],
                [
                  t('signup.next.checkIn'),
                  checkInAt
                    ? `${fmtWeekdayTime(checkInAt)}${checkInEnd ? `–${fmtTime(checkInEnd)}` : ''}`
                    : t('signup.todo.notSet'),
                ],
                [
                  t('signup.next.firstMatch'),
                  firstMatchAt ? fmtWeekdayTime(firstMatchAt) : t('signup.todo.notSet'),
                ],
              ].map(([label, value]) => (
                <Box
                  component="li"
                  key={label}
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 2,
                    py: 1.25,
                    borderTop: `1px solid ${color.rule}`,
                  }}
                >
                  <span>{label}</span>
                  <Box component="span" sx={{ ...mono, color: color.ink2 }}>
                    {value}
                  </Box>
                </Box>
              ))}
            </Box>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.75,
                p: 2,
                borderRadius: radii.md,
                bgcolor: color.paper3,
              }}
            >
              <Typography component="span" sx={eyebrowSx}>
                {t('signup.yourLineup')}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <TeamLogo team={{ id: team.id, name: team.name, tag: team.tag }} size="sm" />
                <Typography component="span" sx={{ fontWeight: 700 }}>
                  {team.name}
                </Typography>
                <AvatarStack
                  players={starters.map((m) => ({ name: m.name, avatar: m.avatar }))}
                  size={28}
                />
              </Box>
              <Typography component="span">
                {starters.map((m) => m.name).join(' · ')}
                {subs.length > 0 && (
                  <Box component="span" sx={{ color: color.muted }}>
                    {' · '}
                    {t('signup.subsLine', { names: subs.map((m) => m.name).join(', ') })}
                  </Box>
                )}
              </Typography>
              <Link
                component="button"
                type="button"
                onClick={() => setStep('lineup')}
                sx={{ alignSelf: 'flex-start', fontSize: '0.875rem' }}
              >
                {t('signup.change')}
              </Link>
            </Box>
            <Box
              component="label"
              sx={{
                display: 'flex',
                gap: 1.5,
                alignItems: 'flex-start',
                p: 2,
                borderRadius: radii.md,
                border: `1px solid ${color.rule}`,
                cursor: 'pointer',
              }}
            >
              <Checkbox
                checked={rulesOk}
                onChange={(e) => setRulesOk(e.target.checked)}
                inputProps={{ 'data-testid': 'signup-rules' } as never}
                sx={{ p: 0, mt: 0.25 }}
              />
              <Typography component="span">
                {t('signup.vouch')}{' '}
                <Link component={RouterLink} to={tournamentTabPath(tournament.id, 'rules')}>
                  {t('signup.rulesLink')}
                </Link>
                .{' '}
                <Box component="span" sx={{ color: color.muted }}>
                  {t('signup.vouchNote')}
                </Box>
              </Typography>
            </Box>
            {error && <Alert severity="error">{error}</Alert>}
            <Button
              variant="contained"
              size="large"
              disabled={!rulesOk || sending}
              onClick={() => void send()}
              data-testid="signup-send"
              sx={{ alignSelf: 'flex-start', px: 4 }}
            >
              {t('signup.send', { team: team.name })}
            </Button>
          </Box>
        )
      )}
    </Box>
  );
}
