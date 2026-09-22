import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PlayerAvatar } from '../PlayerAvatar';
import { PlayerName } from '../PlayerName';
import { fetchMyGames } from '../../games/gamesApi';
import { mono } from '../../../theme/tokens';

export interface ProfileHeaderTeam {
  id?: string;
  name: string;
  tag?: string;
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
 * Public profile header: avatar, name, "Plays … · joined …", team chip, and
 * (own profile only) an "Edit profile" link to the account connections page.
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
  const teamLabel = team
    ? t('playerPage.teamChip', { team: `${team.tag ? `[${team.tag}] ` : ''}${team.name}` })
    : null;

  return (
    <Card data-testid="profile-header">
      <CardContent>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 2,
            flexWrap: 'wrap',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 2, sm: 3 }, minWidth: 0, flex: 1 }}>
            <PlayerAvatar id={playerId} name={name} avatarUrl={avatarUrl} size={80} isAdmin={isAdmin} />
            <Box minWidth={0}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <PlayerName
                  name={name}
                  isAdmin={isAdmin}
                  variant="h4"
                  sx={{ fontWeight: 700 }}
                  data-testid="public-player-name"
                />
                {isAdmin && (
                  <Chip label={t('playerPage.admin')} color="error" size="small" sx={{ fontWeight: 600 }} />
                )}
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="profile-header-sub">
                {playsLabel ? `${playsLabel} · ` : ''}
                {t('playerPage.profileHeader.joined', { date: joinedLabel })}
              </Typography>
              {teamLabel && (
                <Box mt={1}>
                  {isLinkableTeam ? (
                    <Chip
                      data-testid="public-player-team"
                      size="small"
                      variant="outlined"
                      color="secondary"
                      label={teamLabel}
                      component={RouterLink}
                      to={`/team/${teamId}`}
                      clickable
                      sx={{ fontWeight: 600 }}
                    />
                  ) : (
                    <Chip
                      data-testid="public-player-team"
                      size="small"
                      variant="outlined"
                      color="secondary"
                      label={teamLabel}
                      sx={{ fontWeight: 600 }}
                    />
                  )}
                </Box>
              )}
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ ...mono, fontSize: '0.75rem', mt: 0.75 }}
              >
                {t('playerPage.steamId', { id: playerId })}
              </Typography>
            </Box>
          </Box>
          {isOwnProfile && (
            <Button
              variant="outlined"
              size="small"
              component={RouterLink}
              to="/me/connections"
              data-testid="profile-edit-link"
            >
              {t('playerPage.profileHeader.editProfile')}
            </Button>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
