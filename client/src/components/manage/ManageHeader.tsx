import { Box, Button } from '@mui/material';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AtIcon } from '../common/AtIcon';
import { AdminNoticeBell } from '../admin/AdminNoticeBell';
import { AccountMenu } from '../layout/AccountMenu';
import { SiteSearch } from '../search/SiteSearch';
import { paths } from '../../paths';
import { fontDisplay, tokens } from '../../theme/tokens';

/**
 * Manage is its own dashboard (2026-10): no public top bar, this header in
 * its place. The way back to the site, the admin notices, search and the
 * account menu; the rail below is the whole admin menu.
 */
export function ManageHeader() {
  const { t } = useTranslation();
  return (
    <Box
      component="header"
      data-testid="manage-header"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        minHeight: 64,
        px: { xs: 2, md: 3 },
        borderBottom: `1px solid ${tokens.color.rule}`,
        bgcolor: tokens.color.navGlass,
        backdropFilter: 'blur(14px)',
        position: 'sticky',
        top: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        displayPrint: 'none',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          fontFamily: fontDisplay,
          fontWeight: 600,
        }}
      >
        <Box
          sx={{ height: 26, width: 26, borderRadius: '7px', overflow: 'hidden', display: 'flex' }}
        >
          <AtIcon size={26} title="Auto Tournament" />
        </Box>
        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
          {t('nav.manageHome')}
        </Box>
      </Box>
      <Button
        component={RouterLink}
        to={paths.root}
        size="small"
        color="inherit"
        startIcon={<ArrowLeftIcon size={16} aria-hidden />}
        sx={{ color: 'text.secondary', minHeight: 36 }}
        data-testid="manage-back-to-site"
      >
        {t('nav.backToSite')}
      </Button>
      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
        <SiteSearch />
        <AdminNoticeBell />
        <AccountMenu />
      </Box>
    </Box>
  );
}
