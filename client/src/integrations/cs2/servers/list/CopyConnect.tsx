/** An address that copies `connect <address>` (what players paste in the CS2 console) when clicked. */
import type { MouseEvent, ReactNode } from 'react';
import { ButtonBase, Tooltip } from '@mui/material';
import { mono, tokens, useModuleTranslation, useSnackbar } from '../../../../module-sdk';

export function CopyConnect({ address, children }: { address: string; children?: ReactNode }) {
  const { t } = useModuleTranslation('cs2');
  const { showSnackbar, showError } = useSnackbar();
  const copy = (e: MouseEvent) => {
    // Inside a row: copying must not open the row's panel.
    e.stopPropagation();
    navigator.clipboard.writeText(`connect ${address}`).then(
      () =>
        showSnackbar(
          t('serversList.connectCopied', { defaultValue: 'Connect command copied' }),
          'success'
        ),
      () => showError(t('fleetPanel.copyFailed'))
    );
  };
  return (
    <Tooltip
      title={`${t('serversList.copyConnect', { defaultValue: 'Copy the connect command' })}: connect ${address}`}
    >
      <ButtonBase
        onClick={copy}
        sx={{
          ...mono,
          font: 'inherit',
          color: 'inherit',
          display: 'inline-block',
          maxWidth: '100%',
          textAlign: 'left',
          verticalAlign: 'bottom',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          borderRadius: 0.5,
          '&:hover': { color: tokens.color.accent },
          '&.Mui-focusVisible': { outline: `2px solid ${tokens.color.focus}` },
        }}
      >
        {children ?? address}
      </ButtonBase>
    </Tooltip>
  );
}
