import { Box, Paper, Typography } from '@mui/material';
import { CheckIcon, CircleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { visuallyHidden } from './layout';
import { tokens } from '../../../theme';

export interface SummaryRow {
  key: string;
  label: string;
  value: string;
  /** Not set yet: shown muted. */
  pending?: boolean;
}

export interface ChecklistItem {
  key: string;
  label: string;
  met: boolean;
}

interface SetupSummaryProps {
  gameName: string;
  gameMark: string;
  /** The module's own square tile for the game, when it ships one; else the mark. */
  gameIcon?: string;
  name: string;
  rows: SummaryRow[];
  checklist: ChecklistItem[];
}

/** The live summary on the right: reads like the event page will, updates as you go. */
export function SetupSummary({
  gameName,
  gameMark,
  gameIcon,
  name,
  rows,
  checklist,
}: SetupSummaryProps) {
  const { t } = useTranslation();

  return (
    <Box
      component="aside"
      aria-label={t('tournament.setup.summary.label')}
      data-testid="tournament-setup-summary"
      sx={{ display: 'grid', gap: 2, alignContent: 'start' }}
    >
      <Paper variant="outlined" sx={{ p: 3, display: 'grid', gap: 2 }}>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}
          data-testid="tournament-summary-game"
        >
          <Box
            component="span"
            aria-hidden="true"
            sx={{
              display: 'grid',
              placeItems: 'center',
              overflow: 'hidden',
              ...(gameIcon
                ? { width: 20, height: 20, borderRadius: `${tokens.radius.sm / 2}px` }
                : {
                    px: 0.75,
                    py: 0.25,
                    borderRadius: `${tokens.radius.sm / 2}px`,
                    bgcolor: 'background.surface2',
                    color: 'text.primary',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                  }),
            }}
          >
            {gameIcon ? (
              <Box
                component="img"
                src={gameIcon}
                alt=""
                // `contain`, never `cover`: the tiles are square today, and a
                // tile that is ever not square must letterbox rather than crop.
                sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              gameMark
            )}
          </Box>
          {gameName}
        </Typography>
        <Typography
          variant="h5"
          component="h2"
          data-testid="tournament-summary-name"
          sx={{ color: name ? 'text.primary' : 'text.disabled', overflowWrap: 'anywhere' }}
        >
          {name || t('tournament.setup.summary.untitled')}
        </Typography>
        <Box
          component="dl"
          sx={{
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr)',
            columnGap: 2,
            rowGap: 0.75,
            m: 0,
            fontSize: '0.875rem',
          }}
        >
          {rows.map((row) => (
            <Box key={row.key} sx={{ display: 'contents' }}>
              <Box component="dt" sx={{ color: 'text.disabled' }}>
                {row.label}
              </Box>
              <Box
                component="dd"
                data-testid={`tournament-summary-${row.key}`}
                sx={{
                  m: 0,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  color: row.pending ? 'text.disabled' : 'text.primary',
                  overflowWrap: 'anywhere',
                }}
              >
                {row.value}
              </Box>
            </Box>
          ))}
        </Box>
      </Paper>

      <Paper
        variant="outlined"
        sx={{ px: 3, py: 2, display: 'grid', gap: 1 }}
        data-testid="tournament-setup-checklist"
      >
        <Typography component="h3" variant="body2" fontWeight={600}>
          {t('tournament.setup.checklist.title')}
        </Typography>
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 0.75 }}>
          {checklist.map((item) => (
            <Box
              component="li"
              key={item.key}
              data-met={item.met ? 'true' : 'false'}
              sx={{
                display: 'flex',
                gap: 1,
                alignItems: 'flex-start',
                fontSize: '0.875rem',
                color: item.met ? 'success.main' : 'text.disabled',
              }}
            >
              {item.met ? (
                <Box component={CheckIcon} size="1rem" aria-hidden="true" sx={{ mt: '2px' }} />
              ) : (
                <Box component={CircleIcon} size="1rem" aria-hidden="true" sx={{ mt: '2px' }} />
              )}
              <span>
                {item.label}
                <Box component="span" sx={visuallyHidden}>
                  {` (${item.met ? t('tournament.setup.checklist.met') : t('tournament.setup.checklist.notMet')})`}
                </Box>
              </span>
            </Box>
          ))}
        </Box>
      </Paper>
    </Box>
  );
}
