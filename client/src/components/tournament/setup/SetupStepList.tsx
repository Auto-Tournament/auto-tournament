import { Box, ButtonBase } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { useTranslation } from 'react-i18next';
import { visuallyHidden } from './layout';
import { tokens, mono } from '../../../theme';
import { SETUP_STEPS, type SetupStepId } from './setupSteps';
import { NARROW } from './layout';

interface SetupStepListProps {
  activeStep: number;
  isDone: (step: SetupStepId, index: number) => boolean;
  onSelect: (index: number) => void;
}

/**
 * The step list on the left. An ordered list of buttons; the current one
 * carries aria-current="step". Under 760px it becomes a horizontal scroller.
 */
export function SetupStepList({ activeStep, isDone, onSelect }: SetupStepListProps) {
  const { t } = useTranslation();

  return (
    <Box
      component="ol"
      aria-label={t('tournament.setup.stepsLabel')}
      data-testid="tournament-setup-steps"
      sx={{
        listStyle: 'none',
        m: 0,
        p: 0,
        display: 'grid',
        gap: 0.5,
        position: 'sticky',
        top: 96,
        [NARROW]: {
          position: 'static',
          gridAutoFlow: 'column',
          gridAutoColumns: 'max-content',
          overflowX: 'auto',
          pb: 0.5,
        },
      }}
    >
      {SETUP_STEPS.map((step, index) => {
        const current = index === activeStep;
        const done = !current && isDone(step, index);
        return (
          <li key={step}>
            <ButtonBase
              type="button"
              onClick={() => onSelect(index)}
              aria-current={current ? 'step' : undefined}
              data-testid={`tournament-setup-step-${step}`}
              data-done={done ? 'true' : undefined}
              sx={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: '1.6rem minmax(0, 1fr)',
                gap: 1.5,
                alignItems: 'center',
                justifyItems: 'start',
                px: 1.25,
                py: 1,
                borderRadius: `${tokens.radius.sm}px`,
                fontSize: '0.875rem',
                whiteSpace: 'nowrap',
                textAlign: 'left',
                color: current ? 'text.primary' : 'text.secondary',
                bgcolor: current ? 'background.paper' : 'transparent',
                '&:hover': { bgcolor: 'background.paper', color: 'text.primary' },
                '&.Mui-focusVisible': {
                  outline: `2px solid ${tokens.color.focus}`,
                  outlineOffset: 2,
                },
              }}
            >
              <Box
                component="span"
                aria-hidden="true"
                sx={{
                  ...mono,
                  width: '1.6rem',
                  height: '1.6rem',
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  border: 1,
                  borderColor: current || done ? 'transparent' : 'divider',
                  bgcolor: current ? 'primary.main' : done ? 'background.surface2' : 'transparent',
                  color: current ? 'primary.contrastText' : done ? 'success.main' : 'text.disabled',
                }}
              >
                {done ? <CheckIcon sx={{ fontSize: '0.9rem' }} /> : index + 1}
              </Box>
              <span>
                {t(`tournament.setup.steps.${step}`)}
                {done && (
                  <Box component="span" sx={visuallyHidden}>
                    {` (${t('tournament.setup.stepDone')})`}
                  </Box>
                )}
              </span>
            </ButtonBase>
          </li>
        );
      })}
    </Box>
  );
}
