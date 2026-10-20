/**
 * "Needs you" on the manage dashboard, from the admins' bell: the open
 * notices that are errors or warnings (stuck matches, crashed servers,
 * failing recorders), each opening where it can be fixed. Same-kind ones stack.
 */
import { Box, Button, ButtonBase, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Panel } from '../common/ui';
import { tokens } from '../../theme/tokens';
import { matchDetailsPath, paths } from '../../paths';
import { useAdminNotices } from '../../hooks/useAdminNotices';
import { useTimeAgo } from '../social/timeAgo';
import { noticeHref, noticeKey, noticeParams, stackNotices } from './adminNoticeText';

const { color } = tokens;

export function AdminNoticesPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const timeAgo = useTimeAgo();
  const { notices, dismiss } = useAdminNotices(true);
  const open = notices.filter((n) => n.resolvedAt === null && n.severity !== 'info');
  if (!open.length) return null;
  return (
    <Panel
      sx={{ p: { xs: 2, md: 2.5 }, display: 'grid', gap: 1 }}
      data-testid="admin-notices-panel"
    >
      <Typography sx={{ fontWeight: 600 }}>{t('adminNotices.needsYou')}</Typography>
      {stackNotices(open)
        .slice(0, 8)
        .map(({ lead: n, rest }) => {
          const to = noticeHref(n, {
            match: matchDetailsPath,
            servers: paths.servers,
            recorders: paths.highlights,
            license: paths.license,
            system: paths.admin,
          });
          return (
            <Box
              key={n.id}
              sx={{
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0,1fr) auto',
                gap: 1.25,
                alignItems: 'center',
              }}
            >
              <Box
                aria-hidden
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  bgcolor: n.severity === 'error' ? color.ban : color.accent,
                }}
              />
              <ButtonBase
                disabled={!to}
                onClick={() => to && navigate(to)}
                sx={{ display: 'block', textAlign: 'left', minWidth: 0 }}
              >
                <Typography sx={{ fontSize: '0.875rem', overflowWrap: 'anywhere' }}>
                  {t(noticeKey(n), noticeParams(n))}
                </Typography>
                <Typography sx={{ fontSize: '0.75rem', color: color.muted }}>
                  {timeAgo(n.updatedAt)}
                  {n.count > 1 ? ` · ${t('adminNotices.times', { count: n.count })}` : ''}
                  {rest.length
                    ? ` · ${t('adminNotices.moreLikeThis', { count: rest.length })}`
                    : ''}
                </Typography>
              </ButtonBase>
              <Button
                size="small"
                onClick={() => [n, ...rest].forEach((each) => void dismiss(each.id))}
                sx={{ color: color.ink2 }}
              >
                {rest.length ? t('adminNotices.dismissAll') : t('adminNotices.dismiss')}
              </Button>
            </Box>
          );
        })}
    </Panel>
  );
}
