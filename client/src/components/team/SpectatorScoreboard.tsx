import { Box, Chip, Typography } from '@mui/material';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { tokens, mono, radii } from '../../theme/tokens';

const { color } = tokens;

interface SpectatorScoreboardProps {
  team1Name: string;
  team2Name: string;
  team1Rounds: number;
  team2Rounds: number;
  team1Maps: number;
  team2Maps: number;
  mapName?: string | null;
  /** 0-based map index, when known. */
  mapNumber?: number | null;
  totalMaps?: number | null;
  roundsPerMap?: number | null;
  liveStatus?: { label: string; chipColor: 'success' | 'info' | 'warning' | 'default' } | null;
}

/**
 * The match as someone outside it sees it (design draft "Match C"): the round
 * score big in the middle, the teams either side with the maps they have won,
 * and how far the map is. No join controls: they are for the players.
 */
export function SpectatorScoreboard({
  team1Name,
  team2Name,
  team1Rounds,
  team2Rounds,
  team1Maps,
  team2Maps,
  mapName,
  mapNumber,
  totalMaps,
  roundsPerMap,
  liveStatus,
}: SpectatorScoreboardProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const played = team1Rounds + team2Rounds;
  const segments = roundsPerMap && roundsPerMap > 0 && roundsPerMap <= 40 ? roundsPerMap : null;

  const score = (value: number, key: string) => (
    <motion.span
      key={`${key}-${value}`}
      initial={reduceMotion ? false : { y: -10, opacity: 0, scale: 1.08 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 28 }}
      style={{ display: 'inline-block' }}
    >
      {value}
    </motion.span>
  );

  return (
    <Box
      data-testid="spectator-scoreboard"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'minmax(0,1fr) auto minmax(0,1fr)' },
        alignItems: 'center',
        gap: { xs: 2, sm: 4 },
        p: { xs: 2.5, sm: 4 },
        borderRadius: radii.lg,
        bgcolor: color.paper2,
        border: `1px solid ${color.rule}`,
        textAlign: { xs: 'center', sm: 'left' },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h5" component="p" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
          {team1Name}
        </Typography>
        <Typography variant="body2" sx={{ color: color.muted }}>
          {t('matchInfo.spectator.maps', { count: team1Maps })}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        <Typography variant="body2" sx={{ ...mono, color: color.muted, fontSize: '0.75rem' }}>
          {[
            typeof mapNumber === 'number'
              ? totalMaps && totalMaps > 1
                ? t('matchInfo.spectator.mapOf', { n: mapNumber + 1, total: totalMaps })
                : t('matchInfo.mapN', { n: mapNumber + 1 })
              : null,
            mapName,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Typography>
        <Box
          component="p"
          aria-label={t('matchInfo.spectator.scoreAria', { a: team1Rounds, b: team2Rounds })}
          sx={{ m: 0, display: 'flex', alignItems: 'baseline', gap: 2.5, fontWeight: 700, lineHeight: 1, fontSize: { xs: '3.5rem', sm: '5rem' } }}
        >
          {score(team1Rounds, 'a')}
          <Box component="span" sx={{ fontSize: '0.4em', color: color.muted }}>
            :
          </Box>
          {score(team2Rounds, 'b')}
        </Box>
        {liveStatus && <Chip size="small" label={liveStatus.label} color={liveStatus.chipColor} />}
      </Box>

      <Box sx={{ minWidth: 0, textAlign: { xs: 'center', sm: 'right' } }}>
        <Typography variant="h5" component="p" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
          {team2Name}
        </Typography>
        <Typography variant="body2" sx={{ color: color.muted }}>
          {t('matchInfo.spectator.maps', { count: team2Maps })}
        </Typography>
      </Box>

      {segments && (
        <Box
          sx={{ gridColumn: '1 / -1', display: 'flex', gap: 0.5 }}
          aria-label={t('matchInfo.spectator.roundsPlayed', { played, total: segments })}
        >
          {Array.from({ length: segments }, (_, i) => (
            <Box
              key={i}
              sx={{
                flex: 1,
                height: 8,
                borderRadius: radii.pill,
                bgcolor: i < played ? color.ink2 : 'transparent',
                border: i < played ? 'none' : `1px dashed ${color.rule}`,
              }}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
