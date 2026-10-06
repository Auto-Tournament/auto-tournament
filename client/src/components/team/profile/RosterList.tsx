import type { ComponentType } from 'react';
import { Box, Chip, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PlayerAvatar } from '../../player/PlayerAvatar';
import { Panel, Row, RowList } from '../../common/ui';
import { getPlayerPageUrl } from '../../../utils/playerLinks';
import type { Player } from '../../../types';
import type { RosterMemberStatusProps } from '../../../integrations/types';
import { fontMono, textSize, tokens } from '../../../theme/tokens';

/** A roster entry with what the team page knows about the player in this team. */
export type RosterPlayer = Player & {
  /** The player's job (a position id from the team's game), or null. */
  position?: string | null;
  lineup?: 'starter' | 'sub';
  /** Matches played for this team. */
  matches?: number;
  kd?: number | null;
  adr?: number | null;
  monthDelta?: number | null;
};

interface RosterListProps {
  players: RosterPlayer[];
  /** Label for a position id (the team's game's own words), or none. */
  positionLabel?: (position: string) => string;
  /**
   * The game module's line about each member's account for the game (CS2:
   * "Steam linked"). Absent for a game with nothing to say.
   */
  MemberStatus?: ComponentType<RosterMemberStatusProps>;
}

/** Whether the roster entry points at a player the site has a page for. */
function hasProfile(player: Player): boolean {
  return !!player.steamId && player.steamId !== 'unknown';
}

/**
 * Public team profile roster (the draft's `ul.row-list.panel` of members):
 * avatar, name, a detail line with the role and the game's account status,
 * and the rating. Captains first, then by rating.
 */
export function RosterList({ players, MemberStatus, positionLabel }: RosterListProps) {
  const { t } = useTranslation();

  // Starters, then subs; within each, the owner and captains first, then by rating.
  const rank = (p: Player) => (p.role === 'owner' ? 2 : p.role === 'captain' ? 1 : 0);
  const sorted = [...players].sort(
    (a, b) =>
      Number(a.lineup === 'sub') - Number(b.lineup === 'sub') ||
      rank(b) - rank(a) ||
      (b.elo ?? 0) - (a.elo ?? 0)
  );

  if (sorted.length === 0) {
    return (
      <Panel data-testid="team-profile-roster" sx={{ px: 3, py: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {t('teamProfile.roster.empty')}
        </Typography>
      </Panel>
    );
  }

  return (
    <RowList data-testid="team-profile-roster">
      {sorted.map((player, index) => {
        const linkable = hasProfile(player);
        const roleLabel =
          player.role === 'owner'
            ? t('teamProfile.roster.owner')
            : player.role === 'captain'
              ? t('teamProfile.roster.captain')
              : null;
        const isSub = player.lineup === 'sub';
        const position = player.position && positionLabel ? positionLabel(player.position) : null;
        const hasNumbers = typeof player.kd === 'number' || typeof player.adr === 'number';
        return (
          <Row key={player.steamId || index} data-testid="team-profile-roster-row" sx={{ p: 0 }}>
            <Box
              component={linkable ? RouterLink : 'div'}
              to={linkable ? getPlayerPageUrl(player.steamId) : undefined}
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'auto minmax(0, 1fr) auto',
                  sm: 'auto minmax(0, 1fr) auto auto',
                },
                alignItems: 'center',
                gap: 2,
                px: 3,
                py: 1.5,
                width: '100%',
                minWidth: 0,
                color: 'inherit',
                textDecoration: 'none',
                borderRadius: 'inherit',
                '&:hover': linkable ? { bgcolor: 'action.hover' } : undefined,
              }}
            >
              <PlayerAvatar
                id={player.steamId || String(index)}
                name={player.name}
                avatarUrl={player.avatar}
                size={36}
              />
              <Box minWidth={0}>
                <Typography variant="body2" fontWeight={600} noWrap>
                  {player.name}
                </Typography>
                {(roleLabel || position || isSub || MemberStatus) && (
                  <Box
                    component="small"
                    data-testid="team-profile-roster-detail"
                    sx={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      columnGap: 0.75,
                      color: tokens.color.muted,
                      fontSize: textSize.xs,
                      // "Captain · Steam linked": a dot between the parts
                      // that are there, whichever they are.
                      '& > * + *::before': { content: '"·"', mr: 0.75 },
                    }}
                  >
                    {isSub && (
                      <span data-testid="team-profile-roster-sub">
                        {t('teamProfile.roster.subLine', { count: player.matches ?? 0 })}
                      </span>
                    )}
                    {roleLabel && <span>{roleLabel}</span>}
                    {position && <span data-testid="team-profile-roster-position">{position}</span>}
                    {MemberStatus && <MemberStatus playerId={player.steamId ?? ''} />}
                  </Box>
                )}
              </Box>
              <Box
                data-testid="team-profile-roster-numbers"
                sx={{
                  display: { xs: 'none', sm: 'flex' },
                  gap: 2,
                  fontFamily: fontMono,
                  fontSize: textSize.xs,
                  color: tokens.color.muted,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {hasNumbers && (
                  <>
                    <span>{t('teamProfile.roster.kd', { kd: player.kd?.toFixed(2) ?? '—' })}</span>
                    <span>{t('teamProfile.roster.adr', { adr: player.adr ?? '—' })}</span>
                  </>
                )}
              </Box>
              {typeof player.elo === 'number' ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
                  <Chip
                    size="small"
                    label={t('teamProfile.roster.rating', { rating: player.elo })}
                  />
                  {!!player.monthDelta && (
                    <Box
                      component="span"
                      sx={{
                        fontFamily: fontMono,
                        fontSize: textSize.xs,
                        color: player.monthDelta > 0 ? tokens.color.pick : tokens.color.ban,
                      }}
                    >
                      {player.monthDelta > 0 ? '+' : ''}
                      {player.monthDelta}
                    </Box>
                  )}
                </Box>
              ) : (
                <span />
              )}
            </Box>
          </Row>
        );
      })}
    </RowList>
  );
}
