import { pageTitle } from '../utils/pageTitle';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { PageHead } from '../components/common/ui';
import { useSnackbar } from '../contexts/SnackbarContext';
import {
  Box,
  Typography,
  Paper,
  Stack,
  Button,
  LinearProgress,
  Tabs,
  Tab,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
} from '@mui/material';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { api } from '../utils/api';
import type { SettingsResponse } from '../types/api.types';
import { useIsDevelopment } from '../hooks/useIsDevelopment';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { IgdbCredentialsCard } from '../components/games/IgdbCredentialsCard';
import { SiteNameCard } from '../components/settings/SiteNameCard';
import { useInstalledIntegrations } from '../integrations/registry';

declare const __APP_VERSION__: string | undefined;

interface TabPanelProps {
  children?: React.ReactNode;
  index: string;
  value: string;
  'data-testid'?: string;
}

/** A module's tab key: its settings live on a tab of their own (`instanceSettings`). */
function moduleTabKey(moduleId: string): string {
  return `module-${moduleId}`;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`settings-tabpanel-${index}`}
      aria-labelledby={`settings-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

function a11yProps(index: string) {
  return {
    id: `settings-tab-${index}`,
    'aria-controls': `settings-tabpanel-${index}`,
  };
}

const ACCORDION_SX = {
  bgcolor: 'background.paper',
  border: 1,
  borderColor: 'divider',
  boxShadow: 'none',
  // MUI renders a default divider line via :before; hide it so our border is the only separator
  '&:before': { display: 'none' },
} as const;

const ACCORDION_SUMMARY_SX = {
  bgcolor: 'background.paper',
} as const;

const ACCORDION_DETAILS_SX = {
  bgcolor: 'background.surface2',
  borderTop: 1,
  borderColor: 'divider',
} as const;

/** Core's own settings: the ones every game uses. */
interface CoreSettings {
  ratingsEnabled: boolean;
  allowSelfRegister: boolean;
}

const CORE_KEYS = ['ratingsEnabled', 'allowSelfRegister'] as const;

function coreSettingsFrom(settings: SettingsResponse['settings'] | undefined): CoreSettings {
  return {
    ratingsEnabled: settings?.ratingsEnabled ?? true,
    allowSelfRegister: settings?.allowSelfRegister ?? false,
  };
}

/**
 * Settings: what the whole site uses, whatever game it runs (game catalog
 * art, who may sign up, rating updates), then one tab per installed game
 * module with settings of its own (`instanceSettings`; CS2: its webhook URL,
 * map sync and the defaults sent to its servers), and the developer tools.
 */
export default function Settings() {
  const { showSuccess, showError } = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<CoreSettings>(() => coreSettingsFrom(undefined));
  const [saved, setSaved] = useState<CoreSettings>(() => coreSettingsFrom(undefined));
  const [resetApiDialogOpen, setResetApiDialogOpen] = useState(false);
  const [resettingApi, setResettingApi] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDev = useIsDevelopment();
  const { t } = useTranslation();

  // Tabs: core's, then one per installed module that has settings of its own,
  // then Developer. `?section=<module id>` opens that module's tab (the SDK's
  // `links.settings(id)`); a code module may arrive after the page mounts.
  const [searchParams] = useSearchParams();
  const requestedSection = searchParams.get('section');
  const moduleSettings = useInstalledIntegrations().flatMap((integration) =>
    integration.instanceSettings
      ? [
          {
            id: integration.id,
            labelKey: integration.instanceSettings.labelKey,
            Section: integration.instanceSettings.section,
          },
        ]
      : []
  );
  const moduleTabKeys = moduleSettings.map(({ id }) => moduleTabKey(id)).join(' ');
  const [tab, setTab] = useState<string>('integrations');
  useEffect(() => {
    if (!requestedSection) return;
    const key = moduleTabKey(requestedSection);
    if (moduleTabKeys.split(' ').includes(key)) setTab(key);
  }, [requestedSection, moduleTabKeys]);
  const tabKeys = [
    'integrations',
    'players',
    'matches',
    ...moduleTabKeys.split(' ').filter(Boolean),
    ...(isDev ? ['developer'] : []),
  ];
  // A module tab whose module broke or went away falls back to the first tab.
  const activeTab = tabKeys.includes(tab) ? tab : 'integrations';

  const handleTabChange = (_event: React.SyntheticEvent, newValue: string) => {
    setTab(newValue);
  };

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const response: SettingsResponse = await api.get('/api/settings');
      const core = coreSettingsFrom(response.settings);
      setValues(core);
      setSaved(core);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('settingsPage.errors.loadSettings');
      showError(message);
    } finally {
      setLoading(false);
    }
  }, [showError, t]);

  useEffect(() => {
    document.title = pageTitle(t('settingsPage.title'));
    void fetchSettings();
  }, [fetchSettings, t]);

  // Only the fields that changed: every `PUT /api/settings` field is optional.
  const handleSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    const changed = CORE_KEYS.filter((key) => values[key] !== saved[key]);
    if (changed.length === 0) return;
    const body = Object.fromEntries(changed.map((key) => [key, values[key]]));

    try {
      const response: SettingsResponse = await api.put('/api/settings', body);
      const stored = coreSettingsFrom(response.settings);
      setSaved(stored);
      setValues((prev) => ({ ...prev, ...Object.fromEntries(changed.map((k) => [k, stored[k]])) }));
      showSuccess(t('settingsPage.success.saveSettings'));
      window.dispatchEvent(
        new CustomEvent<SettingsResponse['settings']>('at:settingsUpdated', {
          detail: response.settings,
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : t('settingsPage.errors.saveSettings');
      showError(message);
    }
  }, [values, saved, showError, showSuccess, t]);

  // Auto-save a second after a change
  useEffect(() => {
    if (loading || CORE_KEYS.every((key) => values[key] === saved[key])) return;
    saveTimeoutRef.current = setTimeout(() => void handleSave(), 1000);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [values, saved, loading, handleSave]);

  const handleResetApi = useCallback(async () => {
    setResettingApi(true);

    try {
      await api.post('/api/test/reset-database');
      showSuccess(t('settingsPage.developer.resetApiSuccess'));
      await fetchSettings();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('settingsPage.developer.resetApiError');
      showError(message);
    } finally {
      setResettingApi(false);
      setResetApiDialogOpen(false);
    }
  }, [fetchSettings, showError, showSuccess, t]);

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      <PageHead title={t('layout.pageTitle.settings')} subtitle={t('settingsPage.intro')} />

      {loading && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <LinearProgress />
        </Paper>
      )}

      {!loading && (
        <>
          <Paper sx={{ mb: 2 }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tabs
                value={activeTab}
                onChange={handleTabChange}
                textColor="secondary"
                indicatorColor="secondary"
                aria-label={t('settingsPage.title')}
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab
                  label={t('settingsPage.tabs.integrations')}
                  value="integrations"
                  {...a11yProps('integrations')}
                />
                <Tab label={t('settingsPage.tabs.players')} value="players" {...a11yProps('players')} />
                <Tab label={t('settingsPage.tabs.matches')} value="matches" {...a11yProps('matches')} />
                {moduleSettings.map(({ id, labelKey }) => (
                  <Tab
                    key={id}
                    label={t(labelKey, { ns: id })}
                    value={moduleTabKey(id)}
                    data-testid={`settings-tab-module-${id}`}
                    {...a11yProps(moduleTabKey(id))}
                  />
                ))}
                {isDev && (
                  <Tab
                    label={t('settingsPage.tabs.developer')}
                    value="developer"
                    {...a11yProps('developer')}
                  />
                )}
              </Tabs>
            </Box>

            <TabPanel value={activeTab} index="integrations">
              <Stack spacing={3}>
                <SiteNameCard />

                <Divider />

                <IgdbCredentialsCard />
              </Stack>
            </TabPanel>

            {/* Players & access control */}
            <TabPanel value={activeTab} index="players">
              <Stack spacing={3}>
                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    {t('settingsPage.players.registration.title')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mb={2}>
                    {t('settingsPage.players.registration.description')}
                  </Typography>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={values.allowSelfRegister}
                        onChange={(event) =>
                          setValues((prev) => ({ ...prev, allowSelfRegister: event.target.checked }))
                        }
                        color="primary"
                        size="small"
                      />
                    }
                    label={t('settingsPage.players.registration.toggleLabel')}
                  />
                  <Typography variant="caption" color="text.secondary" display="block">
                    {t('settingsPage.players.registration.recommendation')}
                  </Typography>
                </Box>
              </Stack>
            </TabPanel>

            {/* Rating rules: every game's completed matches update ratings */}
            <TabPanel value={activeTab} index="matches">
              <Stack spacing={3}>
                <Accordion defaultExpanded sx={ACCORDION_SX}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={ACCORDION_SUMMARY_SX}>
                    <Box>
                      <Typography variant="h6" fontWeight={600}>
                        {t('settingsPage.matchRating.ratings.title')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('settingsPage.matchRating.ratings.description')}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={ACCORDION_DETAILS_SX}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={values.ratingsEnabled}
                          onChange={(event) =>
                            setValues((prev) => ({ ...prev, ratingsEnabled: event.target.checked }))
                          }
                          color="primary"
                          size="small"
                        />
                      }
                      label={t('settingsPage.matchRating.ratings.toggleLabel')}
                    />
                    <Typography variant="caption" color="text.secondary" display="block">
                      {t('settingsPage.matchRating.ratings.note')}
                    </Typography>
                  </AccordionDetails>
                </Accordion>
              </Stack>
            </TabPanel>

            {/* Each installed module's own settings (CS2: webhook URL, map sync, server defaults) */}
            {moduleSettings.map(({ id, Section }) => (
              <TabPanel
                key={id}
                value={activeTab}
                index={moduleTabKey(id)}
                data-testid={`settings-module-${id}`}
              >
                <Section />
              </TabPanel>
            ))}

            {isDev && (
              <TabPanel value={activeTab} index="developer">
                <Stack spacing={3}>
                  <Box>
                    <Typography variant="h6" fontWeight={600} gutterBottom color="error">
                      {t('settingsPage.developer.resetApiTitle')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mb={2}>
                      {t('settingsPage.developer.resetApiDescription')}
                    </Typography>
                    <Button
                      variant="outlined"
                      color="error"
                      onClick={() => setResetApiDialogOpen(true)}
                      disabled={resettingApi}
                      data-testid="settings-reset-api-button"
                    >
                      {resettingApi
                        ? t('settingsPage.developer.resetApiButtonLoading')
                        : t('settingsPage.developer.resetApiButton')}
                    </Button>
                  </Box>
                </Stack>
              </TabPanel>
            )}
          </Paper>

          <Box mt={2} display="flex" justifyContent="flex-end" alignItems="center">
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ textAlign: 'right' }}
              data-testid="settings-version"
            >
              {t('settingsPage.footer.version')}{' '}
              {typeof __APP_VERSION__ !== 'undefined'
                ? __APP_VERSION__
                : t('settingsPage.footer.unknownVersion')}
            </Typography>
          </Box>

          <Dialog
            open={resetApiDialogOpen}
            onClose={() => {
              if (!resettingApi) {
                setResetApiDialogOpen(false);
              }
            }}
            aria-labelledby="reset-api-dialog-title"
          >
            <DialogTitle id="reset-api-dialog-title">
              {t('settingsPage.developer.resetApiDialog.title')}
            </DialogTitle>
            <DialogContent>
              <Typography variant="body2" color="text.secondary">
                {t('settingsPage.developer.resetApiDialog.description')}
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setResetApiDialogOpen(false)} disabled={resettingApi}>
                {t('settingsPage.developer.resetApiDialog.cancel')}
              </Button>
              <Button
                color="error"
                variant="contained"
                onClick={handleResetApi}
                disabled={resettingApi}
                autoFocus
              >
                {resettingApi
                  ? t('settingsPage.developer.resetApiDialog.confirmLoading')
                  : t('settingsPage.developer.resetApiDialog.confirm')}
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </Box>
  );
}
