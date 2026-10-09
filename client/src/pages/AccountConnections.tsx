import { PartyInviteSetting } from '../components/social/PartyInviteSetting';
import { pageTitle } from '../utils/pageTitle';
import React, { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { InfoIcon } from '@phosphor-icons/react';
import { ProviderLogo, hasProviderLogo } from '../components/auth/ProviderLogo';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { PlayerAvatar } from '../components/player/PlayerAvatar';
import { GamePicker } from '../components/games/GamePicker';
import { GAMES_UPDATED_EVENT, fetchMyGames, saveMyGames, type GameSummary } from '../components/games/gamesApi';
import {
  apiErrorFlag,
  cancelSteamMerge,
  fetchConnections,
  mergeSteamPlayer,
  reconfirmPassword,
  removeSignInMethod,
  startLink,
  type ConnectionsResponse,
  type GameAccount,
  type SignInMethod,
} from '../components/account/connectionsApi';
import { ChangePasswordDialog } from '../components/account/ChangePasswordDialog';
import { useSnackbar } from '../contexts/SnackbarContext';
import { apiErrorMessage } from '../utils/api';
import { fontDisplay, tokens } from '../theme/tokens';

const { color, radius } = tokens;

/**
 * The provider's own mark on its tile — the same icons as the login page's
 * buttons — so Steam reads as Steam, not as a letter "S". A provider without
 * one gets a short text mark, or the label's first letter.
 */
function ProviderTile({ provider, label }: { provider: string; label: string }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: 40,
        height: 40,
        flex: 'none',
        borderRadius: `${radius.sm}px`,
        bgcolor: color.paper3,
        color: color.ink2,
        display: 'grid',
        placeItems: 'center',
        fontFamily: fontDisplay,
        fontWeight: 700,
        fontSize: '0.875rem',
        '& svg': { fontSize: 22, width: 22, height: 22 },
      }}
    >
      {hasProviderLogo(provider) ? <ProviderLogo id={provider} size={22} /> : label.slice(0, 1).toUpperCase()}
    </Box>
  );
}

/** A row in a flat list panel: tile, text, trailing actions. Wraps on narrow screens. */
function Row({
  tile,
  title,
  badge,
  children,
  end,
  testId,
}: {
  tile: React.ReactNode;
  title: React.ReactNode;
  badge?: React.ReactNode;
  children?: React.ReactNode;
  end?: React.ReactNode;
  testId?: string;
}) {
  return (
    <Box
      component="li"
      data-testid={testId}
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '40px minmax(0, 1fr)', sm: '40px minmax(0, 1fr) auto' },
        gap: 2,
        alignItems: 'center',
        px: { xs: 2, sm: 3 },
        py: 2,
        '& + &': { borderTop: `1px solid ${color.rule}` },
      }}
    >
      {tile}
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography component="span" fontWeight={600}>
            {title}
          </Typography>
          {badge}
        </Box>
        {children}
      </Box>
      {end && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', gridColumn: { xs: 2, sm: 'auto' } }}>
          {end}
        </Box>
      )}
    </Box>
  );
}

function ListPanel({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <Box
      component="ul"
      aria-label={label}
      sx={{
        listStyle: 'none',
        m: 0,
        p: 0,
        bgcolor: color.paper2,
        border: `1px solid ${color.rule}`,
        borderRadius: `${radius.lg}px`,
        overflow: 'hidden',
      }}
    >
      {children}
    </Box>
  );
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Box component="section" aria-labelledby={id} sx={{ '& + &': { mt: 6 } }}>
      <Typography id={id} component="h2" variant="h6" sx={{ fontFamily: fontDisplay, fontWeight: 600 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2, maxWidth: '62ch' }}>
        {description}
      </Typography>
      {children}
    </Box>
  );
}

const muted = { color: color.muted, fontSize: '0.875rem' } as const;

/**
 * The connected account as its provider describes it: picture, name, email
 * and the provider's account id, so you can tell which account is linked.
 * Name, picture and email fill in at the next sign-in with that provider.
 */
function ConnectedAccount({
  account,
  idLabel,
}: {
  account: NonNullable<SignInMethod['account']>;
  idLabel: string;
}) {
  const secondary = [account.email, `${idLabel} ${account.id}`].filter(Boolean).join(' · ');
  return (
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0, mt: 0.5 }}>
      {account.avatarUrl && (
        <Avatar src={account.avatarUrl} alt="" sx={{ width: 28, height: 28, flex: 'none' }} imgProps={{ referrerPolicy: 'no-referrer' }} />
      )}
      <Box sx={{ minWidth: 0 }}>
        {account.name && (
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, overflowWrap: 'anywhere' }}>{account.name}</Typography>
        )}
        <Typography sx={{ ...muted, fontSize: '0.8rem', overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' }}>
          {secondary}
        </Typography>
      </Box>
    </Stack>
  );
}

/** What to do once the admin password has been confirmed again. */
type ReauthNext =
  | { kind: 'link'; provider: string }
  | { kind: 'merge' }
  | { kind: 'remove'; method: SignInMethod };

export default function AccountConnections() {
  const { t, i18n } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [draftGames, setDraftGames] = useState<GameSummary[]>([]);
  const [savingGames, setSavingGames] = useState(false);
  const [removing, setRemoving] = useState<SignInMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [reauthNext, setReauthNext] = useState<ReauthNext | null>(null);
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [mergeDismissed, setMergeDismissed] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchConnections());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  const loadGames = useCallback(async () => {
    try {
      const mine = await fetchMyGames();
      setGames(mine ? mine.games : null);
      setDraftGames(mine ? mine.games : []);
    } catch {
      setGames(null);
    }
  }, []);

  useEffect(() => {
    document.title = pageTitle(t('account.title'));
  }, [t]);

  useEffect(() => {
    void load();
    void loadGames();
    const onUpdated = () => void loadGames();
    window.addEventListener(GAMES_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(GAMES_UPDATED_EVENT, onUpdated);
  }, [load, loadGames]);

  // Back from a link flow: /me/connections?link=ok|taken|failed|reauth|merge&provider=github
  useEffect(() => {
    const outcome = searchParams.get('link');
    if (!outcome || (!data && !loadFailed)) return;
    const provider = searchParams.get('provider') ?? '';
    const label = data?.signInMethods.find((m) => m.provider === provider)?.label ?? provider;
    if (outcome === 'ok') showSuccess(t('account.signIn.linked', { provider: label }));
    else if (outcome === 'taken') showError(t('account.signIn.taken', { provider: label }));
    else if (outcome === 'reauth') openReauth({ kind: 'link', provider });
    // 'merge': the merge dialog opens from `pendingMerge`.
    else if (outcome !== 'merge') showError(t('account.signIn.linkFailed', { provider: label }));
    const next = new URLSearchParams(searchParams);
    next.delete('link');
    next.delete('provider');
    setSearchParams(next, { replace: true });
    // Once per flag, after the first load so the provider's label is known.
  }, [searchParams, data, loadFailed]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatDate = (seconds: number) =>
    new Date(seconds * 1000).toLocaleDateString(i18n.language, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  const labelOf = (method: SignInMethod) =>
    method.provider === 'local' ? t('account.signIn.localLabel') : method.label;

  function openReauth(next: ReauthNext) {
    setPassword('');
    setTotp('');
    setReauthError(null);
    setReauthNext(next);
  }

  /** Connect a provider; an account with an admin login confirms its password first. */
  const connect = (provider: string) => {
    if (data?.localLogin && !data.localLogin.reauthFresh) openReauth({ kind: 'link', provider });
    else startLink(provider);
  };

  const doRemove = async (method: SignInMethod) => {
    setBusy(true);
    try {
      setData(await removeSignInMethod(method.provider));
      showSuccess(t('account.signIn.removed', { provider: labelOf(method) }));
      setRemoving(null);
    } catch (err) {
      if (apiErrorFlag(err, 'reauthRequired')) {
        setRemoving(null);
        openReauth({ kind: 'remove', method });
      } else {
        showError(apiErrorMessage(err, t('account.signIn.removeFailed')));
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (removing) await doRemove(removing);
  };

  const doMerge = async () => {
    setBusy(true);
    try {
      await mergeSteamPlayer();
      // The account is the Steam player now: reload so every part of the app sees it.
      window.location.assign('/me/connections?link=ok&provider=steam');
    } catch (err) {
      if (apiErrorFlag(err, 'reauthRequired')) {
        openReauth({ kind: 'merge' });
      } else {
        showError(apiErrorMessage(err, t('account.merge.failed')));
        setMergeDismissed(true);
        void load();
      }
    } finally {
      setBusy(false);
    }
  };

  const cancelMerge = async () => {
    setMergeDismissed(true);
    try {
      await cancelSteamMerge();
    } catch {
      // It expires on its own after 10 minutes.
    }
    void load();
  };

  const submitReauth = async () => {
    const next = reauthNext;
    setBusy(true);
    setReauthError(null);
    try {
      await reconfirmPassword(password, totp.trim() || undefined);
      setReauthNext(null);
      setPassword('');
      setTotp('');
      setData((d) => (d && d.localLogin ? { ...d, localLogin: { ...d.localLogin, reauthFresh: true } } : d));
      if (next?.kind === 'link') startLink(next.provider);
      else if (next?.kind === 'merge') void doMerge();
      else if (next?.kind === 'remove') void doRemove(next.method);
    } catch (err) {
      setReauthError(
        apiErrorFlag(err, 'totpRequired') && !totp.trim()
          ? t('account.reauth.totpNeeded')
          : apiErrorMessage(err, t('account.reauth.failed'))
      );
    } finally {
      setBusy(false);
    }
  };

  const saveGames = async () => {
    setSavingGames(true);
    try {
      const saved = await saveMyGames(draftGames);
      setGames(saved.games);
      setDraftGames(saved.games);
      showSuccess(t('games.profile.saved'));
    } catch (err) {
      showError(apiErrorMessage(err, t('games.profile.saveFailed')));
    } finally {
      setSavingGames(false);
    }
  };

  const gamesChanged =
    games !== null &&
    (games.length !== draftGames.length || games.some((g, i) => g.id !== draftGames[i]?.id));

  const readOnly = data?.isImpersonating ?? false;
  const steamGames = data?.gameAccounts.find((a) => a.provider === 'steam')?.games ?? [];

  const railLinks = data
    ? [
        { key: 'profile', label: t('account.rail.profile'), to: `/player/${data.account.steamId}` },
        { key: 'connections', label: t('account.rail.connections'), to: '/me/connections', current: true },
      ]
    : [];

  const gamesFirst = !readOnly && games !== null && games.length === 0;
  const gamesSection = games !== null && (
    <Box sx={{ scrollMarginTop: 96, mt: gamesFirst ? 0 : 6, mb: gamesFirst ? 5 : 0 }}>
      <Section id="account-games" title={t('games.profile.title')} description={t('games.profile.description')}>
        <Box
          sx={{
            bgcolor: color.paper2,
            border: `1px solid ${color.rule}`,
            borderRadius: `${radius.lg}px`,
            p: { xs: 2, sm: 3 },
          }}
        >
          {readOnly ? (
            <Typography sx={muted}>
              {games.length === 0
                ? t('games.profile.empty')
                : games.map((g) => g.name).join(', ')}
            </Typography>
          ) : (
            <>
              <GamePicker value={draftGames} onChange={setDraftGames} />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 }}>
                <Button
                  onClick={() => setDraftGames(games)}
                  disabled={!gamesChanged || savingGames}
                >
                  {t('games.profile.cancel')}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => void saveGames()}
                  disabled={!gamesChanged || savingGames}
                  startIcon={
                    savingGames ? <CircularProgress size={16} color="inherit" /> : undefined
                  }
                  data-testid="account-games-save"
                >
                  {t('games.profile.save')}
                </Button>
              </Box>
            </>
          )}
        </Box>
      </Section>
    </Box>
  );

  return (
    <Box minHeight="100vh" bgcolor="transparent">
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
        {!data && !loadFailed && (
          <Box display="flex" justifyContent="center" py={10}>
            <CircularProgress />
          </Box>
        )}
        {loadFailed && <Alert severity="error">{t('account.loadFailed')}</Alert>}

        {data && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '13rem minmax(0, 1fr)' },
              gap: { xs: 3, md: 6 },
            }}
          >
            <Box
              component="nav"
              aria-label={t('account.rail.label')}
              sx={{
                display: 'flex',
                flexDirection: { xs: 'row', md: 'column' },
                gap: 0.5,
                alignSelf: 'start',
                position: { md: 'sticky' },
                top: { md: 96 },
                overflowX: { xs: 'auto', md: 'visible' },
              }}
            >
              {railLinks.map((link) => (
                <Button
                  key={link.key}
                  component={RouterLink}
                  to={link.to}
                  aria-current={link.current ? 'page' : undefined}
                  sx={{
                    justifyContent: 'flex-start',
                    borderRadius: `${radius.sm}px`,
                    px: 1.5,
                    whiteSpace: 'nowrap',
                    color: link.current ? 'text.primary' : 'text.secondary',
                    bgcolor: link.current ? color.paper2 : 'transparent',
                    '&:hover': { bgcolor: color.paper2, color: 'text.primary' },
                  }}
                >
                  {link.label}
                </Button>
              ))}
            </Box>

            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 5 }}>
                <PlayerAvatar
                  id={data.account.steamId}
                  name={data.account.name}
                  avatarUrl={data.account.avatar ?? undefined}
                  size={56}
                />
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    component="h1"
                    variant="h4"
                    sx={{
                      fontFamily: fontDisplay,
                      fontWeight: 700,
                      fontSize: { xs: '1.5rem', sm: '2rem' },
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {data.account.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('account.subtitle')}
                  </Typography>
                </Box>
              </Stack>

              {readOnly && (
                <Alert severity="info" sx={{ mb: 4 }}>
                  {t('account.impersonating')}
                </Alert>
              )}

              {/* No games picked yet: the games section comes first, instead of
                  a banner at the top pointing at the same section at the
                  bottom (the page used to show both). */}
              {gamesFirst && gamesSection}

              <Section id="account-game-accounts" title={t('account.gameAccounts.title')} description={t('account.gameAccounts.description')}>
                <ListPanel label={t('account.gameAccounts.title')}>
                  {data.gameAccounts.map((acct: GameAccount) => (
                    <Row
                      key={acct.provider}
                      testId={`game-account-${acct.provider}`}
                      tile={<ProviderTile provider={acct.provider} label={acct.label} />}
                      title={acct.label}
                      end={
                        acct.canConnect && !readOnly ? (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => connect(acct.provider)}
                            data-testid={`game-account-connect-${acct.provider}`}
                          >
                            {t('account.signIn.connect')}
                          </Button>
                        ) : undefined
                      }
                      badge={
                        acct.verified ? (
                          <Chip
                            size="small"
                            label={t('account.gameAccounts.verified')}
                            sx={{ color: color.live, bgcolor: color.paper3 }}
                          />
                        ) : undefined
                      }
                    >
                      {acct.account ? (
                        <ConnectedAccount account={acct.account} idLabel={t('account.signIn.accountId')} />
                      ) : acct.externalId ? (
                        <Typography sx={{ ...muted, overflowWrap: 'anywhere' }}>
                          {t('account.gameAccounts.id', { id: acct.externalId })}
                        </Typography>
                      ) : (
                        <Typography sx={muted}>
                          {acct.signInEnabled
                            ? t('account.gameAccounts.notConnected', { provider: acct.label })
                            : t('account.gameAccounts.notOffered', { provider: acct.label })}
                        </Typography>
                      )}
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.75 }}>
                        {acct.games.map((g) => (
                          <Chip key={g.id} size="small" variant="outlined" label={g.name} />
                        ))}
                      </Box>
                    </Row>
                  ))}
                </ListPanel>
                <Box
                  sx={{
                    display: 'flex',
                    gap: 1.5,
                    alignItems: 'flex-start',
                    mt: 2,
                    px: 3,
                    py: 2,
                    border: `1px dashed ${color.rule}`,
                    borderRadius: `${radius.md}px`,
                    color: color.ink2,
                    fontSize: '0.875rem',
                  }}
                >
                  <Box component={InfoIcon} size={20} sx={{ color: color.muted, mt: '1px' }} />
                  <span>{t('account.gameAccounts.more')}</span>
                </Box>
              </Section>

              <Section id="account-sign-in" title={t('account.signIn.title')} description={t('account.signIn.description')}>
                <ListPanel label={t('account.signIn.title')}>
                  {data.signInMethods.map((method) => {
                    let detail: string;
                    if (method.provider === 'local') {
                      detail = t('account.signIn.localDetail', { username: method.username ?? '' });
                      if (!method.signInEnabled) detail += ` · ${t('account.signIn.turnedOff')}`;
                    } else if (method.primary) {
                      detail =
                        steamGames.length > 0
                          ? t('account.signIn.primaryDetail', {
                              games: steamGames.map((g) => g.name).join(', '),
                            })
                          : t('account.signIn.primaryDetailNoGames');
                    } else if (method.linked) {
                      detail = method.linkedAt
                        ? t('account.signIn.linkedOn', { date: formatDate(method.linkedAt) })
                        : t('account.signIn.connected');
                      if (!method.signInEnabled) detail += ` · ${t('account.signIn.turnedOff')}`;
                    } else {
                      detail = t('account.signIn.notConnected');
                    }

                    let end: React.ReactNode = null;
                    if (method.primary) {
                      end = <Chip size="small" label={t('account.signIn.primary')} />;
                    } else if (method.linked && !readOnly) {
                      const button = (
                        <span>
                          <Button
                            size="small"
                            color="inherit"
                            disabled={!method.removable}
                            onClick={() => setRemoving(method)}
                            data-testid={`sign-in-remove-${method.provider}`}
                          >
                            {t('account.signIn.remove')}
                          </Button>
                        </span>
                      );
                      end = method.removable ? (
                        button
                      ) : (
                        <Tooltip title={t('account.signIn.lastMethod')}>{button}</Tooltip>
                      );
                    } else if (method.canConnect && !readOnly) {
                      end = (
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => connect(method.provider)}
                          data-testid={`sign-in-connect-${method.provider}`}
                        >
                          {t('account.signIn.connect')}
                        </Button>
                      );
                    }

                    // The password login: its owner can change the password here.
                    if (method.provider === 'local' && method.linked && !readOnly && data.localLogin) {
                      end = (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => setChangingPassword(true)}
                            data-testid="sign-in-change-password"
                          >
                            {t('account.changePassword.button')}
                          </Button>
                          {end}
                        </Stack>
                      );
                    }

                    return (
                      <Row
                        key={method.provider}
                        testId={`sign-in-${method.provider}`}
                        tile={<ProviderTile provider={method.provider} label={labelOf(method)} />}
                        title={labelOf(method)}
                        end={end}
                      >
                        {method.linked && method.account && (
                          <ConnectedAccount account={method.account} idLabel={t('account.signIn.accountId')} />
                        )}
                        <Typography sx={muted}>{detail}</Typography>
                      </Row>
                    );
                  })}
                </ListPanel>
              </Section>

              {!readOnly && <PartyInviteSetting />}

              {!gamesFirst && gamesSection}
            </Box>
          </Box>
        )}
      </Container>

      <ChangePasswordDialog
        open={changingPassword}
        totpEnabled={!!data?.localLogin?.totpEnabled}
        onClose={() => setChangingPassword(false)}
        onDone={() => {
          setChangingPassword(false);
          showSuccess(t('account.changePassword.done'));
        }}
      />

      <Dialog
        open={removing !== null}
        onClose={() => !busy && setRemoving(null)}
        aria-labelledby="remove-sign-in-title"
      >
        <DialogTitle id="remove-sign-in-title">
          {t('account.signIn.removeTitle', { provider: removing ? labelOf(removing) : '' })}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('account.signIn.removeBody', { provider: removing ? labelOf(removing) : '' })}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setRemoving(null)} disabled={busy}>
            {t('games.profile.cancel')}
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => void confirmRemove()}
            disabled={busy}
            data-testid="sign-in-remove-confirm"
          >
            {t('account.signIn.remove')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={reauthNext !== null}
        onClose={() => !busy && setReauthNext(null)}
        aria-labelledby="reauth-title"
      >
        <Box
          component="form"
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            void submitReauth();
          }}
        >
          <DialogTitle id="reauth-title">{t('account.reauth.title')}</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              {t('account.reauth.body', { username: data?.localLogin?.username ?? '' })}
            </DialogContentText>
            <TextField
              autoFocus
              fullWidth
              type="password"
              autoComplete="current-password"
              label={t('account.reauth.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              inputProps={{ 'data-testid': 'reauth-password' }}
              sx={{ mb: 2 }}
            />
            {data?.localLogin?.totpEnabled && (
              <TextField
                fullWidth
                autoComplete="one-time-code"
                label={t('account.reauth.totp')}
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                inputProps={{ 'data-testid': 'reauth-totp', inputMode: 'numeric' }}
              />
            )}
            {reauthError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {reauthError}
              </Alert>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button onClick={() => setReauthNext(null)} disabled={busy}>
              {t('games.profile.cancel')}
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={busy || password.length === 0}
              data-testid="reauth-confirm"
            >
              {t('account.reauth.confirm')}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog
        open={!!data?.pendingMerge && !mergeDismissed && reauthNext === null}
        onClose={() => !busy && void cancelMerge()}
        aria-labelledby="merge-title"
      >
        <DialogTitle id="merge-title">{t('account.merge.title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('account.merge.body')}</DialogContentText>
          {data?.pendingMerge && (
            <Stack direction="row" spacing={2} alignItems="center" sx={{ my: 2 }}>
              <PlayerAvatar
                id={data.pendingMerge.steamId}
                name={data.pendingMerge.name}
                avatarUrl={data.pendingMerge.avatar ?? undefined}
                size={40}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
                  {data.pendingMerge.name}
                </Typography>
                <Typography sx={muted}>
                  {t('account.merge.matches', { count: data.pendingMerge.matches })}
                </Typography>
              </Box>
            </Stack>
          )}
          <DialogContentText>{t('account.merge.explain')}</DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => void cancelMerge()} disabled={busy}>
            {t('games.profile.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={() => void doMerge()}
            disabled={busy}
            data-testid="steam-merge-confirm"
          >
            {t('account.merge.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
