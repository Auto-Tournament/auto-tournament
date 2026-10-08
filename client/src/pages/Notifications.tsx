/**
 * Every notice the bell showed (`/notifications`), newest first, with the
 * bell's filters and "Load older".
 */
import React from 'react';
import { Box, Button, Container } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { EmptyPanel, PageHead, Panel } from '../components/common/ui';
import { useAuth } from '../contexts/AuthContext';
import { pageTitle } from '../utils/pageTitle';
import { NoticeItem } from '../components/social/NoticeItem';
import { NoticeFilters, matchesFilter, type NoticeFilter } from '../components/social/NotificationBell';
import { loadOlderNotices, markNoticesRead, useSocial } from '../components/social/socialStore';

export default function Notifications() {
  const { t } = useTranslation();
  const { playerSteamId, impersonation } = useAuth();
  const social = useSocial(Boolean(playerSteamId) && !impersonation);
  const [filter, setFilter] = React.useState<NoticeFilter>('all');
  const [loading, setLoading] = React.useState(false);
  const shown = social.notices.filter((n) => matchesFilter(n, filter));

  React.useEffect(() => {
    document.title = pageTitle(t('social.bell.title'));
  }, [t]);

  return (
    <Box minHeight="100vh" data-testid="notifications-page">
      <TopNavBar />
      <Container maxWidth="md" sx={{ py: { xs: 3, md: 6 } }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <PageHead title={t('social.bell.title')} sx={{ mb: 0 }} />
          <Button variant="outlined" onClick={() => void markNoticesRead()} disabled={social.unread === 0}>
            {t('social.bell.markAllRead')}
          </Button>
        </Box>
        <Box sx={{ mb: 2 }}>
          <NoticeFilters value={filter} onChange={setFilter} />
        </Box>
        {!playerSteamId ? (
          <EmptyPanel title={t('social.friends.signIn')} description={t('social.friends.signInHint')} />
        ) : shown.length === 0 ? (
          <EmptyPanel title={social.ready ? t('social.bell.empty') : t('social.bell.loading')} description={social.ready ? t('social.bell.emptyHint') : ''} />
        ) : (
          <Panel sx={{ p: 0, overflow: 'hidden' }}>
            {shown.map((n) => (
              <NoticeItem key={n.id} notice={n} viewerId={playerSteamId} />
            ))}
          </Panel>
        )}
        {social.more && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
            <Button
              variant="outlined"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                void loadOlderNotices().finally(() => setLoading(false));
              }}
            >
              {t('social.bell.loadOlder')}
            </Button>
          </Box>
        )}
      </Container>
    </Box>
  );
}
