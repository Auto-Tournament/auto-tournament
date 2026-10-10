import { useEffect } from 'react';
import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { PageHead, Panel } from '../components/common/ui';
import { LicenseCard } from '../components/settings/LicenseCard';
import { pageTitle } from '../utils/pageTitle';
import { tokens } from '../theme/tokens';

const { color } = tokens;

/**
 * The license page (/manage/license): the key, where it stands, the daily
 * check-in and the public "Licensed" line. It was a card at the bottom of
 * Settings; `?section=license` there sends people here.
 */
export default function License() {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = pageTitle(t('layout.pageTitle.license'));
  }, [t]);

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      <PageHead title={t('layout.pageTitle.license')} subtitle={t('license.pageIntro')} />
      <Panel
        component="section"
        data-testid="license-page"
        sx={{ p: { xs: 2, md: 3 }, minWidth: 0, borderColor: color.rule }}
      >
        <LicenseCard />
      </Panel>
    </Box>
  );
}
