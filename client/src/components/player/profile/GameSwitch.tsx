import Box from '@mui/material/Box';
import { useTranslation } from 'react-i18next';
import { gameMonogram } from '../../games/GameThumb';
import { fontDisplay } from '../../../theme/tokens';

export interface ProfileGame {
  id: string;
  name: string;
}

export interface GameSwitchProps {
  games: ProfileGame[];
  selectedId: string;
  onSelect: (id: string) => void;
}

/**
 * Pill switch for which of the player's games the stats below describe.
 *
 * Only games the player has recorded match data for are offered (see the
 * `games` list on `/api/players/:id/summary`, derived from the match `game`
 * column via the integrations registry — never a hard-coded game name).
 *
 * With a single game there is nothing to switch, so it renders as one
 * non-interactive, already-selected pill instead of a pointless toggle.
 */
export function GameSwitch({ games, selectedId, onSelect }: GameSwitchProps) {
  const { t } = useTranslation();
  if (games.length === 0) return null;

  const single = games.length === 1;

  return (
    <Box
      role="group"
      aria-label={t('playerPage.gameSwitchLabel')}
      data-testid="profile-game-switch"
      sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}
    >
      {games.map((game) => {
        const selected = game.id === selectedId;
        return (
          <Box
            key={game.id}
            component={single ? 'div' : 'button'}
            type={single ? undefined : 'button'}
            aria-pressed={selected}
            onClick={single ? undefined : () => onSelect(game.id)}
            data-testid={`profile-game-switch-${game.id}`}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              px: 1.25,
              py: 0.5,
              borderRadius: 999,
              border: '1px solid',
              borderColor: selected ? 'text.secondary' : 'divider',
              bgcolor: selected ? 'background.surface2' : 'transparent',
              color: selected ? 'text.primary' : 'text.secondary',
              font: 'inherit',
              fontFamily: 'inherit',
              fontSize: '0.8125rem',
              fontWeight: 500,
              cursor: single ? 'default' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <Box
              aria-hidden
              sx={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'background.surface3',
                fontFamily: fontDisplay,
                fontWeight: 700,
                fontSize: '0.625rem',
              }}
            >
              {gameMonogram(game.name)}
            </Box>
            {game.name}
          </Box>
        );
      })}
    </Box>
  );
}
