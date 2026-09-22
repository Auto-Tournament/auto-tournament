import { Box, ButtonBase } from '@mui/material';
import { tokens } from '../../../theme';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  testId?: string;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  testId?: string;
}

/**
 * A row of mutually exclusive choices. Each choice is a button with
 * aria-pressed, so it works with the keyboard and reads as a toggle group.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  testId,
}: SegmentedControlProps<T>) {
  return (
    <Box
      role="group"
      aria-label={label}
      data-testid={testId}
      sx={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignSelf: 'flex-start',
        maxWidth: '100%',
        gap: '2px',
        p: '2px',
        border: 1,
        borderColor: 'divider',
        borderRadius: `${tokens.radius.pill}px`,
      }}
    >
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <ButtonBase
            key={option.value}
            type="button"
            aria-pressed={pressed}
            disabled={disabled}
            data-testid={option.testId}
            onClick={() => onChange(option.value)}
            sx={{
              px: 1.75,
              py: 1,
              borderRadius: `${tokens.radius.pill}px`,
              fontSize: '0.875rem',
              fontWeight: 500,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              color: pressed ? 'background.default' : 'text.secondary',
              bgcolor: pressed ? 'text.primary' : 'transparent',
              transition: `background-color ${tokens.duration.fast}ms`,
              '&:hover': { bgcolor: pressed ? 'text.primary' : 'action.hover' },
              '&.Mui-focusVisible': {
                outline: `2px solid ${tokens.color.focus}`,
                outlineOffset: 2,
              },
              '&.Mui-disabled': { opacity: 0.5 },
            }}
          >
            {option.label}
          </ButtonBase>
        );
      })}
    </Box>
  );
}
