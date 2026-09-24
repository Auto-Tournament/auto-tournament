import React from 'react';
import {
  Typography,
  Box,
  Button,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { api } from '../utils/api';
import { LogViewer } from '../components/admin/LogViewer';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useInstalledIntegrations } from '../integrations/registry';
import { useTranslation } from 'react-i18next';
import { PageHead } from '../components/common/ui';
import { pageTitle } from '../utils/pageTitle';

/**
 * Admin tools: logs and maintenance, which every instance has, then each
 * installed module's own section (`adminToolsSection`; CS2: RCON and its
 * server events monitor). Without a module that fills the slot, the page is
 * only core's tools.
 */
const AdminTools: React.FC = () => {
  const { showSuccess, showError } = useSnackbar();
  const { t } = useTranslation();
  const moduleSections = useInstalledIntegrations().flatMap((integration) =>
    integration.adminToolsSection
      ? [{ id: integration.id, Section: integration.adminToolsSection }]
      : []
  );

  // Set dynamic page title
  React.useEffect(() => {
    document.title = pageTitle(t('layout.pageTitle.adminTools'));
  }, [t]);

  const handleRecovery = async () => {
    try {
      const response = await api.post<{
        success: boolean;
        message?: string;
      }>('/api/recovery/recover');

      if (response.success) {
        showSuccess(response.message || t('adminToolsPage.recovery.success'));
      } else {
        showError(response.message || t('adminToolsPage.recovery.error'));
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('adminToolsPage.recovery.failedTrigger');
      showError(message);
    }
  };

  return (
    <Box sx={{ width: '100%', height: '100%' }} data-testid="admin-tools-page">
      <PageHead title={t('layout.pageTitle.adminTools')} subtitle={t('adminToolsPage.description')} />

      {/* Match recovery */}
      <Box component="section" data-testid="admin-tools-recovery">
        <Typography variant="h5" fontWeight={600} mb={2}>
          {t('adminToolsPage.recovery.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          {t('adminToolsPage.recovery.description')}
        </Typography>
        <Button variant="contained" color="warning" onClick={handleRecovery}>
          {t('adminToolsPage.recovery.button')}
        </Button>
      </Box>

      <Divider sx={{ my: 4 }} />

      {/* Logs */}
      <Box component="section" data-testid="admin-tools-logs">
        <Typography variant="h5" fontWeight={600} mb={3}>
          {t('adminToolsPage.monitoring.title')}
        </Typography>
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="h6">{t('adminToolsPage.monitoring.appLogs')}</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <LogViewer />
          </AccordionDetails>
        </Accordion>
      </Box>

      {/* Each installed module's own tools, after core's */}
      {moduleSections.map(({ id, Section }) => (
        <Box key={id} data-testid={`admin-tools-module-${id}`}>
          <Divider sx={{ my: 4 }} />
          <Section />
        </Box>
      ))}
    </Box>
  );
};

export default AdminTools;
