import type { ReactNode } from 'react';
import { Box, ButtonBase, Tooltip } from '@mui/material';
import { tokens, radii } from '../../theme/tokens';

const { color } = tokens;

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** An icon before the label. */
  icon?: ReactNode;
  disabled?: boolean;
  /** Why it is disabled, or what it means (a tooltip). */
  title?: string;
  testId?: string;
}

interface CommonProps<T extends string> {
  /** What the choices are about, for screen readers. */
  label: string;
  options: SegmentedOption<T>[];
  disabled?: boolean;
  testId?: string;
  /**
   * `track` (default): the choices joined in one pill, the chosen one filled (a view or mode switch).
   * `chips`: separate pills with a gap, the chosen one outlined in the accent (filters over a list).
   */
  look?: 'track' | 'chips';
  size?: 'small' | 'medium';
}

export type SegmentedControlProps<T extends string> = CommonProps<T> &
  (
    | { multiple?: false; value: T; onChange: (value: T) => void }
    | { multiple: true; value: T[]; onChange: (value: T[]) => void }
  );

/**
 * A row of choices: one at a time (a mode, a view, a filter), or several with
 * `multiple`. Every segmented choice in the app is this; no ToggleButtonGroup,
 * no hand-made radio rows. Each choice is a button with aria-pressed, so it
 * works with the keyboard and reads as a toggle group.
 */
export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>) {
  const { label, options, disabled = false, testId, look = 'track', size = 'medium' } = props;
  const isOn = (v: T) => (props.multiple ? props.value.includes(v) : props.value === v);
  const press = (v: T) => {
    if (props.multiple) {
      props.onChange(
        props.value.includes(v) ? props.value.filter((x) => x !== v) : [...props.value, v]
      );
    } else {
      props.onChange(v);
    }
  };
  const track = look === 'track';
  const small = size === 'small';
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
        gap: track ? '2px' : 1,
        ...(track ? { p: '2px', border: 1, borderColor: 'divider', borderRadius: radii.pill } : {}),
      }}
    >
      {options.map((option) => {
        const pressed = isOn(option.value);
        const button = (
          <ButtonBase
            key={option.value}
            type="button"
            aria-pressed={pressed}
            disabled={disabled || option.disabled}
            data-testid={option.testId}
            onClick={() => press(option.value)}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.75,
              px: small ? 1.5 : 1.75,
              minHeight: track ? (small ? 32 : 36) : small ? 32 : 44,
              borderRadius: radii.pill,
              fontSize: '0.875rem',
              fontWeight: track ? 500 : 600,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              transition: `background-color ${tokens.duration.fast}ms, border-color ${tokens.duration.fast}ms`,
              ...(track
                ? {
                    color: pressed ? color.paper : color.ink2,
                    bgcolor: pressed ? color.ink : 'transparent',
                    '&:hover': { bgcolor: pressed ? color.ink : 'action.hover' },
                  }
                : {
                    border: `2px solid ${pressed ? color.accent : color.rule}`,
                    color: pressed ? color.ink : color.ink2,
                    bgcolor: pressed ? color.paper3 : 'transparent',
                    '&:hover': { borderColor: pressed ? color.accent : color.muted },
                  }),
              '&.Mui-focusVisible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
              '&.Mui-disabled': { opacity: 0.5 },
            }}
          >
            {option.icon}
            {option.label}
          </ButtonBase>
        );
        return option.title ? (
          <Tooltip key={option.value} title={option.title}>
            <span>{button}</span>
          </Tooltip>
        ) : (
          button
        );
      })}
    </Box>
  );
}
