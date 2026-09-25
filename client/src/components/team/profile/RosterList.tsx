import type { ComponentType } from 'react';
import { Box, Chip, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PlayerAvatar } from '../../player/PlayerAvatar';
import { Panel, Row, RowList } from '../../common/ui';
import { getPlayerPageUrl } from '../../../utils/playerLinks';
import type { Player } from '../../../types';
import type { RosterMemberStatusProps } from '../../../integrations/types';
import { textSize, tokens } from '../../../theme/tokens';

interface RosterListProps {
  players: Player[];
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
export function RosterList({ players, MemberStatus }: RosterListProps) {
  const { t } = useTranslation();

  const sorted = [...players].sort((a, b) => {
    const captainFirst = Number(b.role === 'captain') - Number(a.role === 'captain');
    return captainFirst || (b.elo ?? 0) - (a.elo ?? 0);
  });

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
        const isCaptain = player.role === 'captain';
        return (
          <Row
            key={player.steamId || index}
            data-testid="team-profile-roster-row"
            sx={{ p: 0 }}
          >
            <Box
              component={linkable ? RouterLink : 'div'}
              to={linkable ? getPlayerPageUrl(player.steamId) : undefined}
              sx={{
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0, 1fr) auto',
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
                {(isCaptain || MemberStatus) && (
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
                    {isCaptain && <span>{t('teamProfile.roster.captain')}</span>}
                    {MemberStatus && <MemberStatus playerId={player.steamId ?? ''} />}
                  </Box>
                )}
              </Box>
              {typeof player.elo === 'number' && (
                <Chip
                  size="small"
                  label={t('teamProfile.roster.rating', { rating: player.elo })}
                  sx={{ flexShrink: 0 }}
                />
              )}
            </Box>
          </Row>
        );
      })}
    </RowList>
  );
}
