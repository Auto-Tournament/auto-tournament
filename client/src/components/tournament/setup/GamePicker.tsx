/**
 * The setup wizard's "Which game?" step.
 *
 * Three things the first version got wrong, and what this does instead.
 *
 * **The art is the module's.** A tile comes from the module that runs the
 * game (`GameCatalogEntry.icon`), not from the games catalogue. Catalogue
 * logos are Wikidata artwork: every aspect ratio, every colour, and
 * mostly dark — squeezed into a square box on a dark card they were both
 * distorted and invisible. The module tiles are square, full-bleed and share
 * one palette, so they need no plate behind them and nothing is cropped. A
 * tile that is ever not square letterboxes rather than stretches, which the
 * inlined SVG's own `viewBox` does for free.
 *
 * **The tile is inlined, not an `<img>`.** It is written in `var(--at-ember…)`
 * fills, and page CSS cannot reach into an `<img>`, so through one it stayed
 * brand-orange under every theme. See `components/common/ModuleIcon` and
 * `theme/moduleIcons`.
 *
 * Catalogue art is untouched and stays where it belongs — "What do you play?"
 * and a player's profile, where someone is picking their own game out of
 * every game there is, and has to recognise its real logo.
 *
 * **How a game runs is said once.** It is a fact about the module, so it is a
 * heading over the module's games instead of the same sentence repeated on
 * every card. A module the client has no heading for still lists its games;
 * it just gets no heading, which is better than printing an id.
 *
 * **The cards are small.** Tile, name, nothing else, in as many columns as
 * fit — two at 375px, five or six beside the summary on a wide screen.
 */

import { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { ModuleIcon } from '../../common/ModuleIcon';
import { fontDisplay, tokens } from '../../../theme';
import { groupSetupGames, type SetupGame } from './games';

/** The largest a tile is drawn; a narrow column shrinks it, keeping it square. */
const TILE_MAX = 72;

/**
 * A game's square tile, or its text mark when the module ships none — five
 * catalogue titles have no art yet, and a borrowed or stretched picture would
 * be a worse answer than two letters.
 *
 * The same fallback catches a tile that fails to load, so a bad deploy shows
 * a readable card rather than a broken image.
 */
function GameTile({ game }: { game: SetupGame }) {
  const [failed, setFailed] = useState(false);
  const icon = failed ? undefined : game.icon;

  return (
    <Box
      aria-hidden="true"
      sx={{
        width: '100%',
        maxWidth: TILE_MAX,
        aspectRatio: '1 / 1',
        borderRadius: `${tokens.radius.sm}px`,
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        // The neutral plate is the empty box before the tile has decoded, and
        // the mark's own background after; a full-bleed tile covers it, so it
        // is never a plate *behind* artwork.
        bgcolor: 'background.surface2',
        ...(icon
          ? {}
          : {
              border: 1,
              borderColor: 'divider',
              color: 'text.secondary',
              fontFamily: fontDisplay,
              fontWeight: 700,
              fontSize: '1.05rem',
              letterSpacing: '-0.02em',
            }),
      }}
    >
      {icon ? (
        // Inlined rather than drawn as an `<img>`, so the tile's
        // `var(--at-ember…)` fills resolve against the page and it follows the
        // theme (components/common/ModuleIcon). Not lazy either: every tile on
        // this step is on screen or one scroll away, and a card that paints
        // empty and fills in later is exactly the unfinished look this step
        // had.
        <ModuleIcon src={icon} onError={() => setFailed(true)} />
      ) : (
        game.mark
      )}
    </Box>
  );
}

export interface GamePickerProps {
  games: SetupGame[];
  /** The chosen `tournament.game`. */
  value: string;
  onChange: (game: string) => void;
  disabled: boolean;
  /** Labels the whole control when a module group has no heading of its own. */
  label: string;
}

export function GamePicker({ games, value, onChange, disabled, label }: GamePickerProps) {
  const { t } = useTranslation();
  const groups = groupSetupGames(games);

  return (
    <Box sx={{ display: 'grid', gap: 3, minWidth: 0 }}>
      {groups.map((group) => {
        const title = t(`tournament.setup.game.integrationTitles.${group.integrationId}`, {
          defaultValue: '',
        });
        const description = t(
          `tournament.setup.game.integrationDescriptions.${group.integrationId}`,
          { defaultValue: '' }
        );

        return (
          <Box
            key={group.integrationId}
            data-testid={`tournament-game-group-${group.integrationId}`}
            sx={{ display: 'grid', gap: 1.5, minWidth: 0 }}
          >
            {title && (
              <Box sx={{ display: 'grid', gap: 0.25 }}>
                {/* h2 under the step's h1 question: the summary's own h2 comes
                    later in the document, so the levels never skip. */}
                <Typography component="h2" variant="body2" fontWeight={600}>
                  {title}
                </Typography>
                {description && (
                  <Typography variant="body2" color="text.secondary">
                    {description}
                  </Typography>
                )}
              </Box>
            )}
            <Box
              role="group"
              aria-label={title || label}
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 132px), 1fr))',
                gap: 1.5,
              }}
            >
              {group.games.map((entry) => {
                const pressed = entry.id === value;
                return (
                  <ButtonBase
                    key={entry.id}
                    type="button"
                    aria-pressed={pressed}
                    // The game is fixed once the tournament exists: its matches
                    // were built by that module, and nothing moves them to
                    // another one. The chosen card still has to read as chosen,
                    // so only the others fade.
                    disabled={disabled}
                    onClick={() => onChange(entry.id)}
                    data-testid={`tournament-game-option-${entry.id}`}
                    sx={{
                      display: 'grid',
                      justifyItems: 'center',
                      alignContent: 'start',
                      gap: 1,
                      p: 1.5,
                      border: 1,
                      borderColor: pressed ? 'primary.main' : 'divider',
                      borderRadius: `${tokens.radius.md}px`,
                      bgcolor: pressed ? 'background.surface1' : 'transparent',
                      opacity: disabled && !pressed ? 0.5 : 1,
                      transition: `border-color ${tokens.duration.fast}ms ${tokens.ease.out}, background-color ${tokens.duration.fast}ms ${tokens.ease.out}`,
                      '&:hover': { bgcolor: 'background.surface1' },
                      '&.Mui-focusVisible': {
                        outline: `2px solid ${tokens.color.focus}`,
                        outlineOffset: 2,
                      },
                    }}
                  >
                    <GameTile game={entry} />
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      sx={{ textAlign: 'center', lineHeight: 1.3 }}
                    >
                      {entry.name}
                    </Typography>
                  </ButtonBase>
                );
              })}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
