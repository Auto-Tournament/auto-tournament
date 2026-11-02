import type { ComponentProps } from 'react';
import { ConfirmDialog as AtConfirmDialog } from '@auto-tournament/ui';
import { useTranslation } from 'react-i18next';

/** The design system's confirm dialog, in our translations. */
export default function ConfirmDialog(props: ComponentProps<typeof AtConfirmDialog>) {
  const { t } = useTranslation();
  return (
    <AtConfirmDialog
      confirmLabel={t('common.delete')}
      cancelLabel={t('common.cancel')}
      {...props}
    />
  );
}
