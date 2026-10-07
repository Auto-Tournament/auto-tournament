import Box from '@mui/material/Box';
import { useTranslation } from 'react-i18next';
import { gameMonogram } from '../../games/GameThumb';
import { fontDisplay, radii } from '../../../theme/tokens';

export interface ProfileGame {
  id: string;
  name: string;
}

export interface GameSwitchProps {
  games: ProfileGame[];
  /** Modules' own tabs after the games (CS2: Loadout), ids prefixed by the caller. */
  extraTabs?: Array<{ id: string; name: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
}

/**
 * The profile's tabs: one per game the player has match data for. There is
 * no overview across games: what a profile shows (rating, numbers, matches)
 * belongs to a game. `selectedId` is the game's id.
 *
 * Games come from the `games` list on `/api/players/:id/summary`, derived
 * from the match `game` column via the integrations registry, never a
 * hard-coded game name. With no games there is nothing to choose.
 */
export function GameSwitch({ games, extraTabs = [], selectedId, onSelect }: GameSwitchProps) {
  const { t } = useTranslation();
  if (games.length === 0 && extraTabs.length === 0) return null;

  const tabs: Array<{ id: string; name: string; mark?: string }> = [
    ...games.map((game) => ({ id: game.id, name: game.name, mark: gameMonogram(game.name) })),
    ...extraTabs,
  ];

  return (
    <Box
      role="tablist"
      aria-label={t('playerPage.gameSwitchLabel')}
      data-testid="profile-game-switch"
      sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}
    >
      {tabs.map((tab) => {
        const selected = tab.id === selectedId;
        return (
          <Box
            key={tab.id}
            component="button"
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.id)}
            data-testid={`profile-game-switch-${tab.id}`}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              py: 0.625,
              borderRadius: radii.pill,
              border: '1px solid',
              borderColor: selected ? 'text.secondary' : 'divider',
              bgcolor: selected ? 'background.surface2' : 'transparent',
              color: selected ? 'text.primary' : 'text.secondary',
              font: 'inherit',
              fontFamily: 'inherit',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              '&:hover': { color: 'text.primary' },
            }}
          >
            {tab.mark && (
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
                {tab.mark}
              </Box>
            )}
            {tab.name}
          </Box>
        );
      })}
    </Box>
  );
}
