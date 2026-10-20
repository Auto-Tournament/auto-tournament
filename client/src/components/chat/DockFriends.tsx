/**
 * The chat dock's friends: the ones online, each opening your DM with them.
 * A list under the chats in the wide dock; a row of avatars in the narrow one.
 */
import { Box, ButtonBase, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { PlayerAvatar } from '../player/PlayerAvatar';
import { useSocial } from '../social/socialStore';
import { AvatarPresence } from '../social/PresenceDot';
import { radii, textSize, tokens } from '../../theme/tokens';
import { dmChannel, openChat } from './chatStore';

const { color } = tokens;

export function DockFriends({ me, row = false }: { me: string; row?: boolean }) {
  const { t } = useTranslation();
  const social = useSocial(true);
  const online = social.friends.filter((f) => f.online || f.activity);
  if (online.length === 0) return null;

  return (
    <Box
      component="section"
      aria-label={t('chat.friends')}
      data-testid="chat-dock-friends"
      sx={
        row
          ? { display: 'flex', gap: 1, overflowX: 'auto', pb: 0.5 }
          : { display: 'flex', flexDirection: 'column', gap: 0.25, mt: 2 }
      }
    >
      {!row && (
        <Typography sx={{ px: 1, pb: 0.5, fontSize: textSize.xs, color: color.muted }}>
          {t('chat.friends')}
        </Typography>
      )}
      {online.map((f) => (
        <ButtonBase
          key={f.id}
          onClick={() => openChat(dmChannel(me, f.id), f.name)}
          aria-label={t('chat.messageFriend', { name: f.name })}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: 1,
            p: row ? 0.25 : 0.75,
            borderRadius: radii.md,
            flex: 'none',
            '&:hover': { bgcolor: color.paper3 },
            '&:focus-visible': { outline: `2px solid ${color.accent}`, outlineOffset: 2 },
          }}
        >
          <Box sx={{ position: 'relative', display: 'flex' }}>
            <PlayerAvatar id={f.id} name={f.name} avatarUrl={f.avatarUrl ?? undefined} size={28} />
            <AvatarPresence playerId={f.id} size={28} />
          </Box>
          {!row && (
            <Typography
              sx={{
                fontSize: textSize.sm,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {f.name}
            </Typography>
          )}
        </ButtonBase>
      ))}
    </Box>
  );
}
