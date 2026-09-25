import { useLayoutEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { paths } from '../../../paths';
import { tokens, radii, textSize } from '../../../theme/tokens';
import { NARROW } from './layout';
import { SetupStepList } from './SetupStepList';
import { type SetupStepId } from './setupSteps';

const { color } = tokens;

interface SetupColumnProps {
  steps: readonly SetupStepId[];
  activeStep: number;
  isDone: (step: SetupStepId, index: number) => boolean;
  onSelect: (index: number) => void;
}

/**
 * The setup wizard's left column ("C · Setup takes over the page"): a way
 * back to Manage, then the steps. It sits where the Manage rail does, in the
 * shell's column (`useShellColumn`); under 820px it is a row above the page,
 * the link first and the steps scrolling sideways after it.
 */
export function SetupColumn({ steps, activeStep, isDone, onSelect }: SetupColumnProps) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLDivElement>(null);

  // On a phone the steps scroll sideways: keep the current one in view, or
  // "Review" would be selected somewhere off to the right.
  useLayoutEffect(() => {
    const scroller = rowRef.current?.querySelector<HTMLElement>('ol');
    const current = scroller?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!scroller || !current || scroller.scrollWidth <= scroller.clientWidth) return;
    const box = scroller.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    if (item.left < box.left || item.right > box.right) {
      scroller.scrollLeft += item.left - box.left - (box.width - item.width) / 2;
    }
  }, [activeStep]);

  return (
    <Box
      ref={rowRef}
      data-testid="tournament-setup-column"
      sx={{
        display: 'grid',
        gap: 1.5,
        minWidth: 0,
        [NARROW]: { display: 'flex', alignItems: 'center', gap: 1 },
      }}
    >
      <Box
        component={RouterLink}
        to={paths.manage}
        data-testid="tournament-setup-back-to-manage"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifySelf: 'start',
          flex: '0 0 auto',
          gap: 0.75,
          px: 1.25,
          py: 1,
          borderRadius: radii.sm,
          fontSize: textSize.sm,
          lineHeight: 1.4,
          color: color.ink2,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          '&:hover': { bgcolor: color.paper2, color: color.ink },
          '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
          [NARROW]: { pr: 1.5, borderRight: `1px solid ${color.rule}`, borderRadius: 0 },
        }}
      >
        <ArrowLeftIcon size="1rem" aria-hidden />
        {t('tournament.setup.backToManage')}
      </Box>
      <SetupStepList steps={steps} activeStep={activeStep} isDone={isDone} onSelect={onSelect} />
    </Box>
  );
}
