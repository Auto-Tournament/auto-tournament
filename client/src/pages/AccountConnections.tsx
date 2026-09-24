import React, { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  Alert,
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
  Tooltip,
  Typography,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { SiDiscord, SiGithub, SiKeycloak } from 'react-icons/si';
import { FcGoogle } from 'react-icons/fc';
import { SteamIcon } from '../components/icons/SteamIcon';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { PlayerAvatar } from '../components/player/PlayerAvatar';
import { GamePicker } from '../components/games/GamePicker';
import { GAMES_UPDATED_EVENT, fetchMyGames, saveMyGames, type GameSummary } from '../components/games/gamesApi';
import {
  fetchConnections,
  removeSignInMethod,
  startLink,
  type ConnectionsResponse,
  type GameAccount,
  type SignInMethod,
} from '../components/account/connectionsApi';
import { useSnackbar } from '../contexts/SnackbarContext';
import { apiErrorMessage } from '../utils/api';
import { fontDisplay, tokens } from '../theme/tokens';

const { color, radius } = tokens;

/**
 * The provider's own mark on its tile — the same icons as the login page's
 * buttons — so Steam reads as Steam, not as a letter "S". A provider without
 * one gets a short text mark, or the label's first letter.
 */
const PROVIDER_ICON: Record<string, React.ComponentType> = {
  steam: SteamIcon,
  discord: SiDiscord,
  github: SiGithub,
  google: FcGoogle,
  keycloak: SiKeycloak,
};
const PROVIDER_MARK: Record<string, string> = { github: 'GH' };

function ProviderTile({ provider, label }: { provider: string; label: string }) {
  const Icon = PROVIDER_ICON[provider];
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
      {Icon ? <Icon /> : (PROVIDER_MARK[provider] ?? label.slice(0, 1).toUpperCase())}
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
    document.title = t('account.title');
  }, [t]);

  useEffect(() => {
    void load();
    void loadGames();
    const onUpdated = () => void loadGames();
    window.addEventListener(GAMES_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(GAMES_UPDATED_EVENT, onUpdated);
  }, [load, loadGames]);

  // Back from a link flow: /me/connections?link=ok|taken|failed&provider=github
  useEffect(() => {
    const outcome = searchParams.get('link');
    if (!outcome || (!data && !loadFailed)) return;
    const provider = searchParams.get('provider') ?? '';
    const label = data?.signInMethods.find((m) => m.provider === provider)?.label ?? provider;
    if (outcome === 'ok') showSuccess(t('account.signIn.linked', { provider: label }));
    else if (outcome === 'taken') showError(t('account.signIn.taken', { provider: label }));
    else showError(t('account.signIn.linkFailed', { provider: label }));
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

  const confirmRemove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      setData(await removeSignInMethod(removing.provider));
      showSuccess(t('account.signIn.removed', { provider: removing.label }));
      setRemoving(null);
    } catch (err) {
      showError(apiErrorMessage(err, t('account.signIn.removeFailed')));
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
                      {acct.externalId && (
                        <Typography sx={{ ...muted, overflowWrap: 'anywhere' }}>
                          {t('account.gameAccounts.id', { id: acct.externalId })}
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
                  <InfoOutlinedIcon fontSize="small" sx={{ color: color.muted, mt: '1px' }} />
                  <span>{t('account.gameAccounts.more')}</span>
                </Box>
              </Section>

              <Section id="account-sign-in" title={t('account.signIn.title')} description={t('account.signIn.description')}>
                <ListPanel label={t('account.signIn.title')}>
                  {data.signInMethods.map((method) => {
                    let detail: string;
                    if (method.primary) {
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
                          onClick={() => startLink(method.provider)}
                          data-testid={`sign-in-connect-${method.provider}`}
                        >
                          {t('account.signIn.connect')}
                        </Button>
                      );
                    }

                    return (
                      <Row
                        key={method.provider}
                        testId={`sign-in-${method.provider}`}
                        tile={<ProviderTile provider={method.provider} label={method.label} />}
                        title={method.label}
                        end={end}
                      >
                        <Typography sx={muted}>{detail}</Typography>
                      </Row>
                    );
                  })}
                </ListPanel>
              </Section>

              {!gamesFirst && gamesSection}
            </Box>
          </Box>
        )}
      </Container>

      <Dialog
        open={removing !== null}
        onClose={() => !busy && setRemoving(null)}
        aria-labelledby="remove-sign-in-title"
      >
        <DialogTitle id="remove-sign-in-title">
          {t('account.signIn.removeTitle', { provider: removing?.label ?? '' })}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('account.signIn.removeBody', { provider: removing?.label ?? '' })}
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
    </Box>
  );
}
