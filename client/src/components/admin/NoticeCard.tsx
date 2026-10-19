import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useAdminNotices } from '../../hooks/useAdminNotices';
import { noticeKey, noticeParams, type AdminNoticeSeverity } from './adminNoticeText';

const ALERT: Record<AdminNoticeSeverity, 'error' | 'warning' | 'info'> = {
  error: 'error',
  warn: 'warning',
  info: 'info',
};

/**
 * The admin notice a page was opened from (`?notice=<id>`, the bell's links):
 * what happened, and what to do about it, at the top of the page. Dismiss
 * resolves it; close only hides it. Nothing without the parameter, or once
 * the notice is resolved.
 */
export function NoticeCard() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const id = Number(params.get('notice'));
  const { notices, dismiss } = useAdminNotices(Number.isInteger(id) && id > 0);
  const notice = notices.find((n) => n.id === id && n.resolvedAt === null);
  if (!notice) return null;

  const hide = () => {
    const next = new URLSearchParams(params);
    next.delete('notice');
    setParams(next, { replace: true });
  };
  const fix = t(`adminNotices.fix.${noticeKey(notice).replace('adminNotices.kind.', '')}`, {
    ...noticeParams(notice),
    defaultValue: '',
  });
  return (
    <Alert
      severity={ALERT[notice.severity]}
      sx={{ mb: 3 }}
      data-testid="notice-card"
      action={
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            color="inherit"
            onClick={() => void dismiss(notice.id).then(hide)}
            data-testid="notice-card-dismiss"
          >
            {t('adminNotices.dismiss')}
          </Button>
          <Button size="small" color="inherit" onClick={hide}>
            {t('adminNotices.close')}
          </Button>
        </Stack>
      }
    >
      <AlertTitle>{t(noticeKey(notice), noticeParams(notice))}</AlertTitle>
      {fix}
    </Alert>
  );
}
