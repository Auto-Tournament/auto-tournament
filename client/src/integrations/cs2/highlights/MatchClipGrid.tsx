/**
 * A match's highlight clips as a grid of thumbnails, each opening its watch
 * page: on the match page (every map) and on a map's analysis page (that map's).
 */

import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import {
  fontDisplay,
  radii,
  textSize,
  tokens,
  useModuleTranslation,
  VideoThumb,
} from '../../../module-sdk';
import { kindLabel, mapLabel, playTitle, watchClipPath } from './data';

/** One clip, as `GET /api/game/cs2/matches/:slug/highlights` lists it. */
export interface MatchClip {
  id: number;
  playerId: string;
  playerName: string;
  kind: string;
  title: string;
  round: number;
  mapNumber: number;
  map: string | null;
  video: string;
}

export function MatchClipGrid({ clips }: { clips: MatchClip[] }) {
  const { t } = useModuleTranslation('cs2');
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
        gap: 2,
      }}
    >
      {clips.map((c) => (
        <Box
          key={c.id}
          component={RouterLink}
          to={watchClipPath(c.id)}
          sx={{
            color: 'inherit',
            textDecoration: 'none',
            display: 'grid',
            gap: 0.75,
            minWidth: 0,
          }}
        >
          <Box
            sx={{
              position: 'relative',
              aspectRatio: '16 / 9',
              maxWidth: '100%',
              borderRadius: radii.md,
              overflow: 'hidden',
              bgcolor: 'background.surface3',
              border: 1,
              borderColor: 'divider',
            }}
          >
            <VideoThumb src={c.video} at={4} />
            <Box
              component="span"
              sx={{
                position: 'absolute',
                left: 8,
                top: 8,
                px: 1,
                py: 0.25,
                borderRadius: radii.pill,
                bgcolor: tokens.color.accent,
                color: tokens.color.accentInk,
                fontFamily: fontDisplay,
                fontWeight: 700,
                fontSize: textSize.xs,
              }}
            >
              {kindLabel(t, c.kind)}
            </Box>
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
            {c.playerName}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {playTitle(c.title)} · {mapLabel(t, c.map, c.mapNumber)} ·{' '}
            {t('highlights.roundN', { n: c.round })}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
