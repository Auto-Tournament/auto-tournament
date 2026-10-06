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
import { tokens, fontDisplay } from '../../../theme/tokens';

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
  /** The last matches, newest first: true won, false lost (draft A2's "Last 10"). */
  lastResults?: boolean[];
}

interface Progress {
  level: number;
  totalXp: number;
  intoLevel: number;
  forNext: number;
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
  lastResults = [],
}: ProfileHeaderProps) {
  const { t, i18n } = useTranslation();
  const [ownGameNames, setOwnGameNames] = useState<string[] | null>(null);
  // Matchmaking level (draft A2): on the avatar and beside the name. Nothing
  // while matchmaking is off or before the first XP.
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/matchmaking/players/${encodeURIComponent(playerId)}/progress`, { credentials: 'same-origin' })
      .then((res) => (res.ok ? (res.json() as Promise<{ progress: Progress }>) : null))
      .then((body) => !cancelled && setProgress(body?.progress && body.progress.totalXp > 0 ? body.progress : null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [playerId]);

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
      <Box sx={{ position: 'relative', width: 80, height: 80 }}>
        <PlayerAvatar id={playerId} name={name} avatarUrl={avatarUrl} size={80} isAdmin={isAdmin} />
        {progress && (
          <Box
            data-testid="profile-level-badge"
            aria-label={t('playerPage.profileHeader.levelBadge', { level: progress.level })}
            sx={{
              position: 'absolute',
              right: -6,
              bottom: -6,
              minWidth: 30,
              height: 30,
              px: 0.75,
              boxSizing: 'border-box',
              borderRadius: '10px',
              bgcolor: tokens.color.accent,
              color: tokens.color.accentInk,
              border: `3px solid ${tokens.color.paper}`,
              display: 'grid',
              placeItems: 'center',
              fontFamily: fontDisplay,
              fontWeight: 700,
              fontSize: '0.8125rem',
            }}
          >
            {progress.level}
          </Box>
        )}
      </Box>
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
              {progress && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 140 }} data-testid="profile-level">
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {t('playerPage.profileHeader.level', { level: progress.level })}
                  </Box>
                  <Box sx={{ height: 6, borderRadius: 3, bgcolor: tokens.color.rule, overflow: 'hidden' }}>
                    <Box sx={{ height: '100%', width: `${Math.min(100, (progress.intoLevel / Math.max(1, progress.forNext)) * 100)}%`, bgcolor: tokens.color.accent }} />
                  </Box>
                  <Box component="span" sx={{ fontSize: '0.75rem', color: tokens.color.muted }}>
                    {t('playerPage.profileHeader.xpToNext', { xp: Math.max(0, progress.forNext - progress.intoLevel), level: progress.level + 1 })}
                  </Box>
                </Box>
              )}
              {lastResults.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }} data-testid="profile-last-ten">
                  <Box component="span" sx={{ fontSize: '0.75rem', color: tokens.color.muted }}>
                    {t('playerPage.profileHeader.lastN', { count: Math.min(10, lastResults.length) })}
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5 }} role="img" aria-label={lastResults.slice(0, 10).map((w) => (w ? 'W' : 'L')).join(' ')}>
                    {lastResults.slice(0, 10).map((won, i) => (
                      <Box key={i} sx={{ width: 10, height: 22, borderRadius: '3px', bgcolor: won ? tokens.color.live : tokens.color.ban, opacity: won ? 1 : 0.75 }} />
                    ))}
                  </Box>
                </Box>
              )}
              {isOwnProfile ? (
              <Button
                variant="outlined"
                size="small"
                component={RouterLink}
                to="/me/connections"
                data-testid="profile-edit-link"
              >
                {t('playerPage.profileHeader.editProfile')}
              </Button>
              ) : null}
            </Box>
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
