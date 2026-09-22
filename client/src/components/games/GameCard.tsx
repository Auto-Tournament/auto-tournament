import { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import { useTranslation } from 'react-i18next';
import { gameMonogram } from './GameThumb';
import { tokens, withAlpha, fontDisplay } from '../../theme/tokens';
import type { GameSummary } from './gamesApi';

const { color, radius } = tokens;

interface GameCardProps {
  game: GameSummary;
  selected: boolean;
  onToggle: (game: GameSummary) => void;
}

/**
 * A big selectable card for the "/welcome/games" onboarding grid: image (or a
 * monogram tile when there is none), name, year, up to 2 genre chips, and a
 * "Tournaments supported" marker. Selection is an accent border + a check
 * badge — never colour alone — and it is a real button, so Enter/Space
 * toggle it and `aria-pressed` reflects the state for assistive tech.
 */
export function GameCard({ game, selected, onToggle }: GameCardProps) {
  const { t } = useTranslation();
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(game.imageUrl) && !imageFailed;
  const genres = game.genres.slice(0, 2);

  return (
    <ButtonBase
      focusRipple
      aria-pressed={selected}
      data-testid={`game-card-${game.slug}`}
      onClick={() => onToggle(game)}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        textAlign: 'left',
        width: '100%',
        borderRadius: `${radius.lg}px`,
        overflow: 'hidden',
        bgcolor: color.paper2,
        border: '2px solid',
        borderColor: selected ? color.accent : color.rule,
        transition: `border-color ${tokens.duration.fast}ms ${tokens.ease.out}, transform ${tokens.duration.fast}ms ${tokens.ease.out}`,
        '&:hover': { borderColor: selected ? color.accent : color.muted },
        '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
      }}
    >
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          height: { xs: 120, sm: 140 },
          bgcolor: withAlpha(color.accent, 0.1),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {showImage ? (
          <Box
            component="img"
            src={game.imageUrl ?? undefined}
            alt=""
            aria-hidden
            loading="lazy"
            onError={() => setImageFailed(true)}
            sx={{ maxWidth: '80%', maxHeight: '80%', objectFit: 'contain' }}
          />
        ) : (
          <Typography
            aria-hidden
            sx={{
              fontFamily: fontDisplay,
              fontWeight: 700,
              fontSize: '2rem',
              letterSpacing: '-0.02em',
              color: color.muted,
            }}
          >
            {gameMonogram(game.name)}
          </Typography>
        )}

        {selected && (
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              width: 26,
              height: 26,
              borderRadius: '50%',
              bgcolor: color.accent,
              color: color.accentInk,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CheckIcon sx={{ fontSize: 18 }} />
          </Box>
        )}
      </Box>

      <Box sx={{ p: 1.5, width: '100%', minWidth: 0 }}>
        <Typography variant="subtitle2" fontWeight={600} noWrap title={game.name}>
          {game.name}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25, flexWrap: 'wrap' }}>
          {game.releaseYear && (
            <Typography variant="caption" color="text.secondary">
              {game.releaseYear}
            </Typography>
          )}
          {genres.map((genre) => (
            <Chip
              key={genre}
              label={genre}
              size="small"
              variant="outlined"
              sx={{ height: 20, fontSize: '0.6875rem', '& .MuiChip-label': { px: 0.75 } }}
            />
          ))}
        </Box>
        {game.supported && (
          <Typography
            variant="caption"
            color="primary"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mt: 0.75 }}
          >
            <EmojiEventsOutlinedIcon sx={{ fontSize: 14 }} aria-hidden />
            {t('games.picker.supported')}
          </Typography>
        )}
      </Box>
    </ButtonBase>
  );
}
