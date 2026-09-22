import { Box, ButtonBase, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { TOURNAMENT_TYPES } from '../../../constants/tournament';
import { tokens } from '../../../theme';

/** Small structural sketch of each bracket, drawn with one stroked path. */
const DIAGRAMS: Record<string, string> = {
  single_elimination: 'M4 8h20v8H4zM4 28h20v8H4zM24 12h12v20H24M36 22h14M50 18h20v8H50z',
  double_elimination:
    'M4 4h18v7H4zM4 15h18v7H4zM22 7h10v11H22M32 12h12M44 9h18v7H44zM4 29h18v7H4zM22 32h22M44 29h18v7H44zM62 12h10v20H62M72 22h14M86 19h18v7H86z',
  swiss:
    'M4 6h30M4 16h30M4 26h30M4 36h30M44 6h30M44 16h30M44 26h30M44 36h30M84 11h30M84 21h30M84 31h30',
  round_robin: 'M20 6h80v32H20zM20 14h80M20 22h80M20 30h80M40 6v32M60 6v32M80 6v32',
  shuffle: 'M10 10l20 24M30 10L10 34M50 10h20v24H50zM90 10l20 24M110 10L90 34',
};

/** Card order from the design: brackets first, then the table formats, then shuffle. */
const ORDER = ['single_elimination', 'double_elimination', 'swiss', 'round_robin', 'shuffle'];

interface FormatCardsProps {
  value: string;
  onChange: (type: string) => void;
  disabled?: boolean;
}

export function FormatCards({ value, onChange, disabled = false }: FormatCardsProps) {
  const { t } = useTranslation();
  const types = TOURNAMENT_TYPES.filter((type) => !type.disabled).sort(
    (a, b) => ORDER.indexOf(a.value) - ORDER.indexOf(b.value)
  );

  return (
    <Box
      role="group"
      aria-label={t('tournament.setup.format.label')}
      data-testid="tournament-type-selector"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 190px), 1fr))',
        gap: 1.5,
      }}
    >
      {types.map((type) => {
        const pressed = type.value === value;
        return (
          <ButtonBase
            key={type.value}
            type="button"
            aria-pressed={pressed}
            disabled={disabled}
            onClick={() => onChange(type.value)}
            data-testid={`tournament-type-option-${type.value}`}
            sx={{
              display: 'grid',
              gap: 1,
              alignContent: 'start',
              gridTemplateColumns: 'minmax(0, 1fr)',
              width: '100%',
              justifyItems: 'start',
              p: 2,
              textAlign: 'left',
              border: 1,
              borderColor: pressed ? 'primary.main' : 'divider',
              borderRadius: `${tokens.radius.md}px`,
              bgcolor: pressed ? 'background.paper' : 'transparent',
              color: 'text.primary',
              '&:hover': { bgcolor: 'background.paper' },
              '&.Mui-focusVisible': {
                outline: `2px solid ${tokens.color.focus}`,
                outlineOffset: 2,
              },
              '&.Mui-disabled': { opacity: 0.6 },
              '& svg path': {
                stroke: pressed ? tokens.color.accent : tokens.color.muted,
                fill: 'none',
                strokeWidth: 1.5,
              },
            }}
          >
            <Box
              component="svg"
              viewBox="0 0 120 44"
              aria-hidden="true"
              sx={{ width: '100%', height: 44 }}
            >
              <path d={DIAGRAMS[type.value] ?? ''} />
            </Box>
            <Typography component="span" fontWeight={600}>
              {t(`tournament.setup.format.names.${type.value}`)}
            </Typography>
            <Typography component="span" variant="body2" color="text.secondary">
              {t(`tournament.setup.format.types.${type.value}`)}
            </Typography>
          </ButtonBase>
        );
      })}
    </Box>
  );
}
