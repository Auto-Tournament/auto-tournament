/**
 * On someone else's profile, for a signed-in player: Add friend (or Accept,
 * Request sent, Friends) and Invite to party.
 */
import React from 'react';
import { Box, Button } from '@mui/material';
import { CheckIcon, UserPlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useMatchmaking } from '../matchmaking/matchmakingStore';
import { acceptFriend, friendRequest, inviteToParty, relationTo, useSocial, type Relation } from './socialStore';

export function ProfileSocialButtons({ playerId, name }: { playerId: string; name: string }) {
  const { t } = useTranslation();
  const { showError, showSnackbar } = useSnackbar();
  const { playerSteamId, impersonation } = useAuth();
  const enabled = Boolean(playerSteamId) && !impersonation && playerSteamId !== playerId;
  const social = useSocial(enabled);
  const { me } = useMatchmaking();
  const [relation, setRelation] = React.useState<Relation | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void relationTo(playerId).then((r) => !cancelled && setRelation(r));
    return () => {
      cancelled = true;
    };
    // Friends or requests changing (here or elsewhere) can change the relation.
  }, [enabled, playerId, social.friends.length, social.incoming.length, social.sent.length]);

  if (!enabled || !relation || relation === 'self') return null;

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      setRelation(await relationTo(playerId));
      if (done) showSnackbar(done, 'success');
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const inParty = me?.party?.members.includes(playerId) ?? false;
  const invited = me?.party?.invited?.some((p) => p.id === playerId) ?? false;

  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }} data-testid="profile-social">
      {relation === 'friend' ? (
        <Button size="small" variant="outlined" disabled startIcon={<CheckIcon size={16} />}>
          {t('social.profile.friends')}
        </Button>
      ) : relation === 'sent' ? (
        <Button size="small" variant="outlined" disabled>
          {t('social.friends.requestSent')}
        </Button>
      ) : relation === 'incoming' ? (
        <Button size="small" variant="contained" disabled={busy} onClick={() => void run(() => acceptFriend(playerId))}>
          {t('social.profile.acceptRequest')}
        </Button>
      ) : (
        <Button
          size="small"
          variant="contained"
          disabled={busy}
          startIcon={<UserPlusIcon size={16} />}
          onClick={() => void run(() => friendRequest(playerId))}
          data-testid="profile-add-friend"
        >
          {t('social.friends.addFriend')}
        </Button>
      )}
      <Button
        size="small"
        variant="outlined"
        disabled={busy || inParty || invited}
        onClick={() => void run(() => inviteToParty(playerId), t('social.invite.sent', { name }))}
        data-testid="profile-invite"
      >
        {inParty ? t('social.friends.inParty') : invited ? t('social.invite.invited') : t('social.profile.invite')}
      </Button>
    </Box>
  );
}
