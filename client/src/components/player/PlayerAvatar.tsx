import type { ComponentProps } from 'react';
import { PlayerAvatar as AtPlayerAvatar } from '@auto-tournament/ui';
import { AvatarPresence } from '../social/PresenceDot';

export { playerInitials } from '@auto-tournament/ui';

export type PlayerAvatarProps = ComponentProps<typeof AtPlayerAvatar> & {
  /** The online / away / offline dot on the corner (needs `id`). On by default. */
  presence?: boolean;
};

const generatedSrc = (id: string) => `/api/players/${id}/avatar.svg`;

/** The design system's player picture, with our generated pictures and presence dot. */
export function PlayerAvatar({ presence = true, size = 32, id, ...props }: PlayerAvatarProps) {
  const playerId = id?.trim() || null;
  return (
    <AtPlayerAvatar
      id={id}
      size={size}
      generatedSrc={generatedSrc}
      overlay={presence && playerId ? <AvatarPresence playerId={playerId} size={size} /> : null}
      {...props}
    />
  );
}
