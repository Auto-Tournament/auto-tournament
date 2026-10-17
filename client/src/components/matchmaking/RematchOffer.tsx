/**
 * The rematch on every page: when a player asks for one after a matchmaking match, everyone
 * who has not answered gets "The other team wants a rematch" (or "Your team wants a rematch")
 * with a 30 s countdown; whoever answered sees where it stands until it is accepted or declined.
 * Each team decides by majority; a party's answer counts for all its members.
 */
import { useEffect, useState } from 'react';
import { Box, Button, Dialog, DialogContent, Stack, Typography } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { tokens, radii, fontDisplay } from '../../theme/tokens';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { matchmakingAction, secondsUntil, type RematchView } from './matchmakingStore';
import { playLobbyPath } from '../../paths';

/** "Waiting for the other team… 18 s", "Rematch declined.", and so on; null when there is nothing to say. */
export function rematchStatus(t: TFunction, r: RematchView, left: number): string | null {
  if (r.lobbyId) return t('matchmaking.room.rematch.accepted');
  if (r.declined) return t('matchmaking.room.rematch.refused');
  if (!r.open || r.you === null || r.offerTeam === null) return null;
  const mine = r.teams.find((x) => x.team === r.team);
  const teamYes = !mine || mine.total === 0 || mine.yes * 2 > mine.total;
  return teamYes
    ? t('matchmaking.room.rematch.waitingOther', { s: left })
    : t('matchmaking.room.rematch.waitingTeam', { s: left });
}

export function RematchOffer({
  rematch,
  skew,
}: {
  rematch: RematchView & { room: string };
  skew: number;
}) {
  const { t } = useTranslation();
  const { showError } = useSnackbar();
  const { pathname } = useLocation();
  const [busy, setBusy] = useState(false);
  const [, setNow] = useState(0);
  const live = rematch.open || (!rematch.declined && !rematch.lobbyId);
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [live]);

  const left = rematch.deadline ? secondsUntil(rematch.deadline, skew) : 0;
  const asking = rematch.open && rematch.you === null && rematch.offerTeam !== null && left > 0;
  const status = rematchStatus(t, rematch, left);
  // The match room shows the status itself.
  const onRoom = pathname === playLobbyPath(rematch.room);
  const ours = rematch.offerTeam === rematch.team;

  const answer = async (accept: boolean) => {
    setBusy(true);
    try {
      await matchmakingAction('POST', `/lobbies/${encodeURIComponent(rematch.room)}/rematch`, {
        accept,
      });
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!asking && status && !onRoom && !rematch.lobbyId && (
        <Box
          role="status"
          data-testid="mm-rematch-bar"
          sx={(theme) => ({
            position: 'fixed',
            left: '50%',
            bottom: 16,
            transform: 'translateX(-50%)',
            zIndex: theme.zIndex.snackbar - 1,
            px: 2.5,
            py: 1,
            bgcolor: tokens.color.navGlass,
            backdropFilter: 'blur(14px)',
            border: `1px solid ${tokens.color.accent}`,
            borderRadius: radii.pill,
            maxWidth: 'calc(100vw - 32px)',
          })}
        >
          <Typography variant="body2">{status}</Typography>
        </Box>
      )}
      <Dialog
        open={asking}
        maxWidth="xs"
        fullWidth
        aria-labelledby="mm-rematch-offer-title"
        data-testid="mm-rematch-offer"
        PaperProps={{
          sx: {
            borderRadius: '28px',
            bgcolor: tokens.color.paper2,
            border: `1px solid ${tokens.color.accent}`,
            backgroundImage: 'none',
          },
        }}
      >
        <DialogContent
          sx={{
            p: { xs: 3, sm: 4 },
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            textAlign: 'center',
          }}
        >
          <Typography sx={{ fontFamily: fontDisplay, fontSize: '2.5rem', fontWeight: 700 }}>
            {left}
          </Typography>
          <Typography
            id="mm-rematch-offer-title"
            component="h2"
            sx={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: '1.5rem' }}
          >
            {ours
              ? t('matchmaking.room.rematch.teamTitle')
              : t('matchmaking.room.rematch.offerTitle')}
          </Typography>
          <Typography sx={{ color: tokens.color.ink2 }}>
            {t('matchmaking.room.rematch.offerBody')}
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ width: '100%' }}>
            <Button
              variant="outlined"
              onClick={() => void answer(false)}
              disabled={busy}
              data-testid="mm-rematch-offer-no"
              sx={{ flex: 1, height: 52, borderRadius: radii.pill }}
            >
              {t('matchmaking.room.rematch.no')}
            </Button>
            <Button
              variant="contained"
              onClick={() => void answer(true)}
              disabled={busy}
              data-testid="mm-rematch-offer-yes"
              sx={{ flex: 2, height: 52, borderRadius: radii.pill, fontWeight: 700 }}
            >
              {t('matchmaking.room.rematch.yes')}
            </Button>
          </Stack>
        </DialogContent>
      </Dialog>
    </>
  );
}
