import { Alert, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';

interface LoadErrorProps {
  /** What failed; defaults to the generic "could not load this page". */
  message?: string;
  onRetry: () => void;
  'data-testid'?: string;
}

/** A failed load with a way to ask again, shown in place of an empty state. */
export function LoadError({
  message,
  onRetry,
  'data-testid': testId = 'load-error',
}: LoadErrorProps) {
  const { t } = useTranslation();
  return (
    <Alert
      severity="error"
      data-testid={testId}
      action={
        <Button color="inherit" size="small" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      }
    >
      {message ?? t('common.loadFailed')}
    </Alert>
  );
}
