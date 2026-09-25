import { Box, IconButton } from '@mui/material';
import { MinusIcon, PlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../../theme';

interface TeamCountStepperProps {
  value: number;
  /** Counts the stepper can land on, ascending. */
  choices: number[];
  onChange: (value: number) => void;
  disabled?: boolean;
  labelledBy?: string;
}

/** − value + control that only lands on allowed counts (e.g. powers of 2). */
export function TeamCountStepper({
  value,
  choices,
  onChange,
  disabled = false,
  labelledBy,
}: TeamCountStepperProps) {
  const { t } = useTranslation();
  const lower = [...choices].reverse().find((c) => c < value);
  const higher = choices.find((c) => c > value);

  return (
    <Box
      role="group"
      aria-labelledby={labelledBy}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        alignSelf: 'flex-start',
        border: 1,
        borderColor: 'divider',
        borderRadius: `${tokens.radius.pill}px`,
      }}
    >
      <IconButton
        size="small"
        aria-label={t('tournament.setup.format.fewerTeams')}
        disabled={disabled || lower === undefined}
        onClick={() => lower !== undefined && onChange(lower)}
        data-testid="tournament-team-count-decrease"
      >
        <MinusIcon size={20} />
      </IconButton>
      <Box
        component="output"
        aria-live="polite"
        data-testid="tournament-team-count"
        sx={{
          minWidth: '3rem',
          textAlign: 'center',
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </Box>
      <IconButton
        size="small"
        aria-label={t('tournament.setup.format.moreTeams')}
        disabled={disabled || higher === undefined}
        onClick={() => higher !== undefined && onChange(higher)}
        data-testid="tournament-team-count-increase"
      >
        <PlusIcon size={20} />
      </IconButton>
    </Box>
  );
}
