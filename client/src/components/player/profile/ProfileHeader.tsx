import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PlayerAvatar } from '../PlayerAvatar';
import { PageHead } from '../../common/ui';
import { fetchMyGames } from '../../games/gamesApi';
import { teamProfilePath } from '../../../paths';

export interface ProfileHeaderTeam {
  id?: string;
  name: string;
  tag?: string;
  /** The player's role in the team, when `team_members` knows it. */
  role?: 'captain' | 'member' | null;
}

export interface ProfileHeaderProps {
  playerId: string;
  name: string;
  avatarUrl?: string | null;
  isAdmin?: boolean;
  /** Unix seconds the player record was created; renders as "joined <month year>". */
  joinedAt: number;
  team?: ProfileHeaderTeam | null;
  /** True when the viewer is looking at their own profile (not impersonating). */
  isOwnProfile: boolean;
}

/**
 * Public profile header (the draft's `.who`): an 80px avatar, then the page
 * head — the name as the page's H1, "Plays … · joined …" under it and "Edit
 * profile" on the right — and the team chip below.
 *
 * Open, not boxed in a card. The Steam ID is not shown here: it is account
 * detail, and the player's own Connections page has it.
 *
 * The "Plays" list only ever reads the signed-in player's own picked games
 * (`/api/me/games`), which is private data — so it is only fetched, and only
 * shown, on the viewer's own profile. It is never asked for on someone else's.
 */
export function ProfileHeader({
  playerId,
  name,
  avatarUrl,
  isAdmin,
  joinedAt,
  team,
  isOwnProfile,
}: ProfileHeaderProps) {
  const { t, i18n } = useTranslation();
  const [ownGameNames, setOwnGameNames] = useState<string[] | null>(null);

  useEffect(() => {
    if (!isOwnProfile) return;
    let cancelled = false;
    void fetchMyGames().then((mine) => {
      if (!cancelled) setOwnGameNames(mine ? mine.games.map((g) => g.name) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [isOwnProfile, playerId]);

  const joinedLabel = new Intl.DateTimeFormat(i18n.language, {
    month: 'short',
    year: 'numeric',
  }).format(new Date(joinedAt * 1000));

  const playsLabel =
    isOwnProfile && ownGameNames && ownGameNames.length > 0
      ? t('playerPage.profileHeader.plays', { games: ownGameNames.join(', ') })
      : null;

  const teamId = team?.id;
  const isLinkableTeam = !!teamId && teamId !== 'team1' && teamId !== 'team2';
  // "Nordlys · captain". The team's own name, never "My team": this is
  // everybody's view of the player, the player's own included.
  const teamLabel = team
    ? [
        `${team.tag ? `[${team.tag}] ` : ''}${team.name}`,
        team.role === 'captain' ? t('playerPage.profileHeader.captain') : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <Box
      component="section"
      aria-label={t('playerPage.profileHeader.label')}
      data-testid="profile-header"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr)',
        gap: { xs: 2, sm: 3 },
        alignItems: 'center',
      }}
    >
      <PlayerAvatar id={playerId} name={name} avatarUrl={avatarUrl} size={80} isAdmin={isAdmin} />
      <Box sx={{ minWidth: 0 }}>
        <PageHead
          sx={{ mb: 0, alignItems: 'center' }}
          title={
            <Box component="span" data-testid="public-player-name">
              {name}
            </Box>
          }
          subtitle={
            <Box component="span" data-testid="profile-header-sub">
              {playsLabel ? `${playsLabel} · ` : ''}
              {t('playerPage.profileHeader.joined', { date: joinedLabel })}
            </Box>
          }
          actions={
            isOwnProfile ? (
              <Button
                variant="outlined"
                size="small"
                component={RouterLink}
                to="/me/connections"
                data-testid="profile-edit-link"
              >
                {t('playerPage.profileHeader.editProfile')}
              </Button>
            ) : undefined
          }
        />
        {(teamLabel || isAdmin) && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
            {teamLabel &&
              (isLinkableTeam ? (
                <Chip
                  data-testid="public-player-team"
                  size="small"
                  label={teamLabel}
                  component={RouterLink}
                  to={teamProfilePath(teamId as string)}
                  clickable
                />
              ) : (
                <Chip data-testid="public-player-team" size="small" label={teamLabel} />
              ))}
            {isAdmin && <Chip size="small" label={t('playerPage.admin')} />}
          </Box>
        )}
      </Box>
    </Box>
  );
}
