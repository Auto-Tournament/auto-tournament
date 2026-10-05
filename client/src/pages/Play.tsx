/**
 * Matchmaking (experimental): find a match alone or with a party.
 * `/play?join=CODE` joins a party from an invite link.
 */
import { useEffect, useRef, useState } from 'react';
import { Box, Button, CircularProgress, Container, Stack, TextField, Typography } from '@mui/material';
import { CopyIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { PageHead, Panel, SectionHead } from '../components/common/ui';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useAuth } from '../contexts/AuthContext';
import { pageTitle } from '../utils/pageTitle';
import { matchmakingAction, secondsUntil, useMatchmaking } from '../components/matchmaking/matchmakingStore';
import { paths } from '../paths';

export default function Play() {
  const { t } = useTranslation();
  const { available, me, skew } = useMatchmaking();
  const { playerSteamId } = useAuth();
  const { showError, showSnackbar } = useSnackbar();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');

  useEffect(() => {
    document.title = pageTitle(t('matchmaking.play.title'));
  }, [t]);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) showSnackbar(done, 'success');
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // An invite link: join once, then drop the code from the address.
  const joined = useRef(false);
  const joinCode = params.get('join');
  useEffect(() => {
    if (!available || !joinCode || joined.current) return;
    joined.current = true;
    void run(() => matchmakingAction('POST', '/party/join', { code: joinCode }), t('matchmaking.party.joined'));
    params.delete('join');
    setParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, joinCode]);

  if (available === null) {
    return (
      <Box minHeight="100vh">
        <TopNavBar />
        <Box display="flex" justifyContent="center" py={10}>
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  const party = me?.party ?? null;
  const isLeader = !party || party.leader === playerSteamId;
  const searching = !!me?.queue;
  const cooldown = me?.cooldownUntil ? secondsUntil(me.cooldownUntil, skew) : 0;
  const inviteLink = party ? `${window.location.origin}${paths.play}?join=${party.inviteCode}` : '';

  return (
    <Box minHeight="100vh">
      <TopNavBar />
      <Container maxWidth="md" sx={{ py: { xs: 3, md: 6 } }}>
        <PageHead title={t('matchmaking.play.title')} subtitle={t('matchmaking.play.subtitle')} />

        {!available ? (
          <Panel sx={{ p: 3 }} data-testid="mm-unavailable">
            <Typography>{t('matchmaking.play.unavailable')}</Typography>
          </Panel>
        ) : (
          <Stack spacing={3}>
            <Panel sx={{ p: 3 }}>
              <SectionHead title={t('matchmaking.play.findTitle')} />
              <Typography color="text.secondary" mb={2}>
                {searching ? t('matchmaking.play.searchingHelp') : t('matchmaking.play.findHelp')}
              </Typography>
              {cooldown > 0 && (
                <Typography color="warning.main" mb={2} data-testid="mm-cooldown">
                  {t('matchmaking.play.cooldown', { minutes: Math.ceil(cooldown / 60) })}
                </Typography>
              )}
              {searching ? (
                isLeader && (
                  <Button
                    variant="outlined"
                    disabled={busy}
                    onClick={() => void run(() => matchmakingAction('DELETE', '/queue'))}
                    data-testid="mm-stop"
                  >
                    {t('matchmaking.queue.cancel')}
                  </Button>
                )
              ) : (
                <Button
                  variant="contained"
                  size="large"
                  disabled={busy || !isLeader || cooldown > 0 || me?.lobby?.status === 'accepting'}
                  onClick={() => void run(() => matchmakingAction('POST', '/queue', { mode: '5v5' }))}
                  data-testid="mm-find"
                >
                  {t('matchmaking.play.find')}
                </Button>
              )}
              {!isLeader && !searching && (
                <Typography color="text.secondary" mt={1}>
                  {t('matchmaking.play.leaderStarts')}
                </Typography>
              )}
            </Panel>

            <Panel sx={{ p: 3 }}>
              <SectionHead title={t('matchmaking.party.title')} />
              {party ? (
                <Stack spacing={2}>
                  <Typography color="text.secondary">
                    {t('matchmaking.party.members', { count: party.members.length })}
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                    <TextField
                      size="small"
                      fullWidth
                      label={t('matchmaking.party.inviteLink')}
                      value={inviteLink}
                      InputProps={{ readOnly: true }}
                      inputProps={{ 'data-testid': 'mm-invite-link' }}
                    />
                    <Button
                      startIcon={<CopyIcon size={18} />}
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(inviteLink)
                          .then(() => showSnackbar(t('matchmaking.party.copied'), 'success'))
                      }
                      sx={{ whiteSpace: 'nowrap' }}
                    >
                      {t('matchmaking.party.copy')}
                    </Button>
                  </Stack>
                  <Box>
                    <Button
                      color="inherit"
                      disabled={busy || me?.lobby?.status === 'accepting'}
                      onClick={() => void run(() => matchmakingAction('POST', '/party/leave'))}
                      data-testid="mm-leave"
                    >
                      {party.leader === playerSteamId ? t('matchmaking.party.disband') : t('matchmaking.party.leave')}
                    </Button>
                  </Box>
                </Stack>
              ) : (
                <Stack spacing={2}>
                  <Typography color="text.secondary">{t('matchmaking.party.help')}</Typography>
                  <Box>
                    <Button
                      startIcon={<UsersThreeIcon size={18} />}
                      disabled={busy}
                      onClick={() => void run(() => matchmakingAction('POST', '/party', { mode: '5v5' }))}
                      data-testid="mm-create-party"
                    >
                      {t('matchmaking.party.create')}
                    </Button>
                  </Box>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <TextField
                      size="small"
                      label={t('matchmaking.party.code')}
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      inputProps={{ maxLength: 16, 'data-testid': 'mm-join-code' }}
                    />
                    <Button
                      disabled={busy || code.trim().length < 6}
                      onClick={() =>
                        void run(() => matchmakingAction('POST', '/party/join', { code: code.trim() }), t('matchmaking.party.joined'))
                      }
                    >
                      {t('matchmaking.party.join')}
                    </Button>
                  </Stack>
                </Stack>
              )}
            </Panel>
          </Stack>
        )}
      </Container>
    </Box>
  );
}
