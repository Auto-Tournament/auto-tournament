/** The Play page's side card: friends online, with Invite, and a link to all of them. */
import React from 'react';
import { Box, Button, Link, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Panel } from '../common/ui';
import { PlayerAvatar } from '../player/PlayerAvatar';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { paths, playerProfilePath } from '../../paths';
import { textSize, tokens } from '../../theme/tokens';
import { inviteToParty, useSocial } from './socialStore';

const { color } = tokens;

export function FriendsCard({ members, invited }: { members: string[]; invited: string[] }) {
  const { t } = useTranslation();
  const { showError, showSnackbar } = useSnackbar();
  const social = useSocial(true);
  const [sending, setSending] = React.useState<string | null>(null);
  const online = social.friends.filter((f) => f.online || f.activity);

  return (
    <Panel component="section" aria-labelledby="mm-friends" sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 0.5 }} data-testid="mm-friends">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.5 }}>
        <Typography id="mm-friends" component="h2" sx={{ fontSize: textSize.sm, fontWeight: 600 }}>
          {t('social.friends.title')}
        </Typography>
        {social.friends.length > 0 && (
          <Typography sx={{ fontSize: '0.75rem', color: color.muted }}>{t('social.friends.onlineCount', { count: online.length })}</Typography>
        )}
      </Box>
      {social.friends.length === 0 ? (
        <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>{t('social.friends.cardEmpty')}</Typography>
      ) : online.length === 0 ? (
        <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>{t('social.invite.nobodyOnline')}</Typography>
      ) : (
        online.slice(0, 5).map((f) => (
          <Box key={f.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 0.75, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
            <Box component={RouterLink} to={playerProfilePath(f.id)} sx={{ position: 'relative', flex: 'none', display: 'flex' }} aria-label={f.name}>
              <PlayerAvatar id={f.id} name={f.name} avatarUrl={f.avatarUrl ?? undefined} size={28} />
              <Box aria-hidden sx={{ position: 'absolute', right: -2, bottom: -2, width: 10, height: 10, borderRadius: '50%', bgcolor: f.activity?.kind === 'playing' ? color.accent : color.live, border: `2px solid ${color.paper2}` }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</Typography>
              <Typography sx={{ fontSize: '0.75rem', color: color.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.activity?.kind === 'playing'
                  ? t('social.status.playing', { match: f.activity.label })
                  : f.activity?.kind === 'searching'
                    ? t('social.status.searching', { mode: f.activity.mode })
                    : t('social.status.online')}
              </Typography>
            </Box>
            {members.includes(f.id) ? (
              <Typography sx={{ fontSize: '0.75rem', color: color.muted }}>{t('social.friends.inParty')}</Typography>
            ) : invited.includes(f.id) ? (
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: color.live }}>{t('social.invite.invited')}</Typography>
            ) : f.invite && f.invite !== true ? (
              <Typography sx={{ fontSize: '0.75rem', color: color.muted }}>{t(`social.invite.cannot.${f.invite}`)}</Typography>
            ) : (
              <Button
                size="small"
                variant="outlined"
                disabled={sending === f.id}
                onClick={() => {
                  setSending(f.id);
                  inviteToParty(f.id)
                    .then(() => showSnackbar(t('social.invite.sent', { name: f.name }), 'success'))
                    .catch((error: Error) => showError(error.message))
                    .finally(() => setSending(null));
                }}
              >
                {t('social.friends.invite')}
              </Button>
            )}
          </Box>
        ))
      )}
      <Link component={RouterLink} to={paths.friends} sx={{ mt: 1, fontSize: '0.75rem', color: color.ink2 }}>
        {social.friends.length > 0 ? t('social.friends.all', { count: social.friends.length }) : t('social.friends.find')}
      </Link>
    </Panel>
  );
}
