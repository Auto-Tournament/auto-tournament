import { pageTitle } from '../utils/pageTitle';
import React from 'react';
import {
  Typography,
  Box,
  Button,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import { CaretDownIcon } from '@phosphor-icons/react';
import { api } from '../utils/api';
import { LogViewer } from '../components/admin/LogViewer';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useInstalledIntegrations } from '../integrations/registry';
import { useTranslation } from 'react-i18next';
import { PageHead, SectionHead } from '../components/common/ui';

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
      <Box component="section" data-testid="admin-tools-recovery" aria-labelledby="admin-tools-recovery-heading">
        <SectionHead id="admin-tools-recovery-heading" title={t('adminToolsPage.recovery.title')} sx={{ mb: 1 }} />
        <Typography variant="body2" color="text.secondary" mb={2}>
          {t('adminToolsPage.recovery.description')}
        </Typography>
        <Button variant="contained" color="warning" onClick={handleRecovery}>
          {t('adminToolsPage.recovery.button')}
        </Button>
      </Box>

      {/* Logs */}
      <Box component="section" mt={6} data-testid="admin-tools-logs" aria-labelledby="admin-tools-logs-heading">
        <SectionHead id="admin-tools-logs-heading" title={t('adminToolsPage.monitoring.title')} />
        <Accordion>
          <AccordionSummary expandIcon={<CaretDownIcon />}>
            <Typography variant="subtitle1" component="h3" fontWeight={600}>
              {t('adminToolsPage.monitoring.appLogs')}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <LogViewer />
          </AccordionDetails>
        </Accordion>
      </Box>

      {/* Each installed module's own tools, after core's */}
      {moduleSections.map(({ id, Section }) => (
        <Box key={id} mt={6} data-testid={`admin-tools-module-${id}`}>
          <Section />
        </Box>
      ))}
    </Box>
  );
};

export default AdminTools;
