import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Link,
  MenuItem,
  Select,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { CheckCircleIcon, PlayCircleIcon, UsersThreeIcon, WarningIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useTournamentPage } from '../components/tournament/page/tournamentPageContext';
import { remindLineupPlayer, useTournamentSignup, viewerRegistration } from '../hooks/useTournamentSignup';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useSetupGames } from '../components/tournament/setup/games';
import { Face, PersonTile, TeamMark } from '../components/tournament/signup/PlayerFace';
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
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editing = params.get('edit') === '1';
  const { tournament } = useTournamentPage();
  const signup = useTournamentSignup(tournament.id);
  const teamSize = tournament.teamSize ?? 5;
  const existing = viewerRegistration(signup);
  const { games } = useSetupGames();
  const gameName = games.find((entry) => entry.id === (tournament.game || 'cs2'))?.name ?? tournament.game ?? 'CS2';
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

  if (!teams.length) {
    return (
      <Box sx={{ maxWidth: 640, p: 3, borderRadius: radii.lg, bgcolor: color.paper2, border: `1px solid ${color.rule}` }} data-testid="signup-no-team">
        <Typography sx={{ fontWeight: 600 }}>{t('signup.noTeamTitle')}</Typography>
        <Typography sx={{ color: color.ink2, mt: 0.5 }}>{t('signup.noTeamBody')}</Typography>
        <Button component={RouterLink} to={paths.browseTeams} variant="outlined" sx={{ mt: 2 }}>
          {t('signup.goToTeams')}
        </Button>
      </Box>
    );
  }

  const starters = team?.members.filter((m) => current[m.steamId] === 'starter') ?? [];
  const subs = team?.members.filter((m) => current[m.steamId] === 'sub') ?? [];
  const missingAccount = [...starters, ...subs].filter((m) => !m.hasAccount);
  const rated = starters.filter((m) => m.rating !== null);
  const rating = rated.length ? Math.round(rated.reduce((s, m) => s + (m.rating ?? 0), 0) / rated.length) : null;
  const lineupOk = starters.length === teamSize && subs.length <= MAX_SUBS;
  const spotsLeft = signup.window?.maxTeams ? signup.window.maxTeams - tournament.teamIds.length : null;
  const checkInAt = signup.window?.checkInOpensAt ? new Date(signup.window.checkInOpensAt) : null;
  const dayAndTime = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

  const setSlot = (steamId: string, slot: Slot) => setSlots({ ...current, [steamId]: slot });

  const send = async () => {
    if (!team) return;
    setSending(true);
    setError('');
    try {
      const body = { teamId: team.id, starters: starters.map((m) => m.steamId), subs: subs.map((m) => m.steamId) };
      if (editing) await api.put(`/api/tournament-signup/${tournament.id}/lineup`, body);
      else await api.post(`/api/tournament-signup/${tournament.id}/register`, { ...body, acceptRules: rulesOk });
      navigate(tournamentTabPath(tournament.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const stepPill = (label: string, active: boolean) => (
    <Box component="li" sx={{ px: 1.75, py: 1, borderRadius: radii.pill, fontSize: '0.875rem', bgcolor: active ? color.accent : color.paper3, color: active ? color.accentInk : color.ink2, fontWeight: active ? 600 : 400 }}>
      {label}
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 960 }} data-testid="signup-page">
      {!editing && (
        <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', gap: 1.25 }}>
          {stepPill(`1 · ${t('signup.steps.lineup')}${step === 'review' ? ' ✓' : ''}`, step === 'lineup')}
          {stepPill(`2 · ${t('signup.steps.review')}`, step === 'review')}
        </Box>
      )}

      {step === 'lineup' ? (
        <>
          {teams.length > 1 && !editing && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              <Typography component="h2" sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}>
                {t('signup.whichTeam')}
              </Typography>
              <Select
                value={teamId ?? ''}
                onChange={(event) => {
                  setPickedTeamId(String(event.target.value));
                  setSlots(null);
                }}
                data-testid="signup-team-select"
                sx={{ alignSelf: 'flex-start', minWidth: 360, borderRadius: '14px', bgcolor: color.paper2 }}
                renderValue={(value) => {
                  const tm = teams.find((x) => x.id === value);
                  return tm ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <TeamMark tag={tm.tag} name={tm.name} highlight />
                      <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                        <Typography sx={{ fontWeight: 600 }}>{tm.name}</Typography>
                        <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
                          {t(`signup.role.${tm.role}`)} · {t('signup.playerCount', { count: tm.members.length })}
                        </Typography>
                      </Box>
                    </Box>
                  ) : null;
                }}
              >
                {teams.map((tm) => (
                  <MenuItem key={tm.id} value={tm.id}>
                    {tm.name}
                  </MenuItem>
                ))}
              </Select>
            </Box>
          )}

          <Box>
            <Typography component="h1" sx={{ fontFamily: fontDisplay, fontSize: '2.125rem', fontWeight: 600 }}>
              {t('signup.whoPlays')}
            </Typography>
            <Typography sx={{ color: color.ink2 }}>{t('signup.whoPlaysHint', { count: teamSize, subs: MAX_SUBS })}</Typography>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,1fr) 300px' }, gap: 4, alignItems: 'start' }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {team?.members.map((m) => (
                <Box key={m.steamId} data-testid="signup-member" sx={{ display: 'grid', gridTemplateColumns: { xs: '44px minmax(0,1fr)', sm: '44px minmax(0,1fr) auto' }, gap: 1.75, alignItems: 'center', p: '10px 14px', borderRadius: '14px', bgcolor: color.paper2 }}>
                  <Face name={m.name} avatar={m.avatar} size={44} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600 }}>
                      {m.name}
                      {m.owner ? (
                        <Box component="span" sx={{ fontWeight: 400, color: color.muted }}>
                          {' · '}
                          {t('signup.ownerTag')}
                        </Box>
                      ) : m.captain ? (
                        <Box component="span" sx={{ fontWeight: 400, color: color.muted }}>
                          {' · '}
                          {t('signup.captainTag')}
                        </Box>
                      ) : null}
                    </Typography>
                    <Typography component="div" sx={{ fontSize: '0.8125rem', color: color.muted, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }} data-testid="signup-member-checks">
                      <Box component="span" sx={{ color: m.hasAccount ? color.live : color.sideT }}>
                        {m.hasAccount ? `✓ ${t('signup.check.steam')}` : t('signup.problem.noAccount')}
                      </Box>
                      {m.hasAccount && m.hasGame !== null && m.hasGame !== undefined && (
                        <Box component="span" sx={{ color: m.hasGame ? color.live : color.sideT }}>
                          · {m.hasGame ? `✓ ${t('signup.check.game', { game: gameName })}` : t('signup.check.noGame', { game: gameName })}
                        </Box>
                      )}
                      {m.hasAccount && m.rating !== null && <span>· {t('signup.rating', { rating: m.rating })}</span>}
                      {(!m.hasAccount || m.hasGame === false) && team && (
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
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={current[m.steamId] ?? 'out'}
                    onChange={(_, value: Slot | null) => value && setSlot(m.steamId, value)}
                    aria-label={t('signup.slotFor', { name: m.name })}
                    sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}
                  >
                    <ToggleButton value="starter">{t('signup.starter')}</ToggleButton>
                    <ToggleButton value="sub">{t('signup.sub')}</ToggleButton>
                    <ToggleButton value="out">{t('signup.out')}</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
              ))}
            </Box>

            <Box component="aside" sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
              <Box sx={{ p: 2.5, borderRadius: radii.lg, bgcolor: color.paper2, border: `1px solid ${color.rule}`, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                {[
                  [t('signup.starters'), `${starters.length} / ${teamSize}`, starters.length === teamSize],
                  [t('signup.subs'), `${subs.length} / ${MAX_SUBS}`, subs.length <= MAX_SUBS],
                  [t('signup.lineupRating'), rating !== null ? String(rating) : '—', true],
                ].map(([label, value, ok]) => (
                  <Box key={String(label)} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                    <Typography sx={{ color: color.ink2, fontSize: 'inherit' }}>{label}</Typography>
                    <Typography sx={{ ...mono, fontSize: 'inherit', color: ok ? color.ink : color.ban }}>{value}</Typography>
                  </Box>
                ))}
              </Box>
              {missingAccount.length > 0 && (
                <Box sx={{ p: 2.25, borderRadius: radii.lg, bgcolor: color.paper2, border: `1px solid ${color.sideT}`, display: 'flex', gap: 1.5 }}>
                  <WarningIcon size={22} color={color.sideT} aria-hidden />
                  <Box>
                    <Typography sx={{ fontWeight: 600 }}>
                      {t('signup.missingAccounts', { names: missingAccount.map((m) => m.name).join(', ') })}
                    </Typography>
                    <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>{t('signup.fixBeforeCheckIn')}</Typography>
                  </Box>
                </Box>
              )}
            </Box>
          </Box>

          {error && <Alert severity="error">{error}</Alert>}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Link component={RouterLink} to={tournamentTabPath(tournament.id)} sx={{ color: color.ink2 }}>
              {t('common.cancel')}
            </Link>
            {editing ? (
              <Button variant="contained" disabled={!lineupOk || sending} onClick={() => void send()} data-testid="signup-save-lineup" sx={{ borderRadius: radii.pill, px: 4, py: 1.5 }}>
                {t('signup.saveLineup')}
              </Button>
            ) : (
              <Button variant="contained" disabled={!lineupOk} onClick={() => setStep('review')} data-testid="signup-next" sx={{ borderRadius: radii.pill, px: 4, py: 1.5 }}>
                {t('signup.nextReview')}
              </Button>
            )}
          </Box>
        </>
      ) : (
        team && (
          <>
            <Typography component="h1" sx={{ fontFamily: fontDisplay, fontSize: '2.125rem', fontWeight: 600 }}>
              {t('signup.readyToSend')}
            </Typography>
            <Box sx={{ p: 3, borderRadius: radii.lg, bgcolor: color.paper2, border: `1px solid ${color.rule}`, display: 'flex', flexDirection: 'column', gap: 2.75 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75 }}>
                <TeamMark tag={team.tag} name={team.name} size={56} highlight />
                <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.5rem', fontWeight: 600 }}>{team.name}</Typography>
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start' }}>
                {starters.map((m) => (
                  <Box key={m.steamId} sx={{ width: 84 }}>
                    <PersonTile name={m.name} avatar={m.avatar} note={m.owner || m.captain ? t('signup.captainTag') : undefined} />
                  </Box>
                ))}
                {subs.length > 0 && <Box sx={{ alignSelf: 'stretch', borderLeft: `1px dashed ${color.rule}`, mx: 1 }} />}
                {subs.map((m) => (
                  <Box key={m.steamId} sx={{ width: 84 }}>
                    <PersonTile name={m.name} avatar={m.avatar} note={t('signup.sub')} />
                  </Box>
                ))}
              </Box>
            </Box>
            <Box sx={{ p: 3, borderRadius: radii.lg, bgcolor: color.paper2, border: `1px solid ${color.rule}`, display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'repeat(3, minmax(0,1fr))' }, gap: 2 }}>
              {[
                [<UsersThreeIcon key="a" size={22} color={color.accent} />, spotsLeft === 1 ? t('signup.next.lastSpot') : t('signup.next.takesSpot'), spotsLeft !== null ? t('signup.next.spotsLeft', { count: Math.max(spotsLeft, 0) }) : ''],
                [<CheckCircleIcon key="b" size={22} color={color.sideT} />, t('signup.next.checkIn'), checkInAt ? dayAndTime.format(checkInAt) : t('signup.todo.notSet')],
                [<PlayCircleIcon key="c" size={22} color={color.live} />, t('signup.next.firstMatch'), tournament.settings?.schedule?.[0] ? dayAndTime.format(new Date(tournament.settings.schedule[0].at)) : t('signup.todo.notSet')],
              ].map(([icon, title, sub], i) => (
                <Box key={i} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                  {icon}
                  <Box>
                    <Typography sx={{ fontWeight: 600 }}>{title}</Typography>
                    <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>{sub}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
            <FormControlLabel
              sx={{ alignItems: 'flex-start', m: 0, p: 2.25, borderRadius: '18px', border: `1px solid ${color.rule}`, gap: 1 }}
              control={<Checkbox checked={rulesOk} onChange={(e) => setRulesOk(e.target.checked)} data-testid="signup-rules" sx={{ p: 0, mt: 0.25 }} />}
              label={
                <Box>
                  <Typography>
                    {t('signup.vouch')}{' '}
                    <Link component={RouterLink} to={tournamentTabPath(tournament.id, 'rules')}>
                      {t('signup.rulesLink')}
                    </Link>
                  </Typography>
                  <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>{t('signup.vouchNote')}</Typography>
                </Box>
              }
            />
            {error && <Alert severity="error">{error}</Alert>}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Link component="button" onClick={() => setStep('lineup')} sx={{ color: color.ink2 }}>
                ← {t('signup.steps.lineup')}
              </Link>
              <Button variant="contained" disabled={!rulesOk || sending} onClick={() => void send()} data-testid="signup-send" sx={{ borderRadius: radii.pill, px: 4, py: 1.75, fontSize: '1rem' }}>
                {t('signup.send', { team: team.name })}
              </Button>
            </Box>
          </>
        )
      )}
    </Box>
  );
}
