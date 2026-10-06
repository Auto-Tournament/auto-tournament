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
  ButtonBase,
  ListSubheader,
  MenuItem,
  Select,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import { CaretDownIcon } from '@phosphor-icons/react';
import { api } from '../utils/api';
import type { SettingsResponse } from '../types/api.types';
import { useIsDevelopment } from '../hooks/useIsDevelopment';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { SiteNameCard } from '../components/settings/SiteNameCard';
import { LicenseCard } from '../components/settings/LicenseCard';
import { WebhooksCard } from '../components/settings/WebhooksCard';
import { ExperimentalCard } from '../components/settings/ExperimentalCard';
import { SignInProvidersCard } from '../components/settings/SignInProvidersCard';
import { useInstalledIntegrations } from '../integrations/registry';

declare const __APP_VERSION__: string | undefined;

/** One entry of the Settings nav: a page. */
interface NavEntry {
  key: string;
  label: string;
}

/** A group of pages: the platform's, then one per game module with settings. */
interface NavGroup {
  id: string;
  label: string;
  entries: NavEntry[];
}

/** Old `?section=` values, from before the pages were regrouped (bookmarks, links in docs). */
const SECTION_ALIASES: Record<string, string> = {
  integrations: 'general',
  matches: 'ratings',
  skins: 'cs2:skins',
};

/** The open page's content, labelled by its nav entry. */
function SettingsPage({ pageKey, children, ...rest }: { pageKey: string; children: React.ReactNode; 'data-testid'?: string }) {
  return (
    <Box
      role="region"
      id={`settings-page-${pageKey.replace(':', '-')}`}
      aria-labelledby={`settings-nav-${pageKey.replace(':', '-')}`}
      {...rest}
    >
      {children}
    </Box>
  );
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

  // The nav: the platform's pages, then a group per installed module with
  // settings of its own (`instanceSettings`), each module page keyed
  // `<module>:<page>`. `?section=` names the open page; a module's id alone
  // opens its first page (the SDK's `links.settings(id)`). A code module may
  // arrive after the page mounts.
  const [searchParams, setSearchParams] = useSearchParams();
  const moduleSettings = useInstalledIntegrations().flatMap((integration) =>
    integration.instanceSettings
      ? [
          {
            id: integration.id,
            labelKey: integration.instanceSettings.labelKey,
            pages: integration.instanceSettings.pages,
            Section: integration.instanceSettings.section,
          },
        ]
      : []
  );
  const groups: NavGroup[] = [
    {
      id: 'platform',
      label: t('settingsPage.groups.platform'),
      entries: [
        { key: 'general', label: t('settingsPage.tabs.general') },
        { key: 'signin', label: t('settingsPage.tabs.signIn') },
        { key: 'players', label: t('settingsPage.tabs.players') },
        { key: 'ratings', label: t('settingsPage.tabs.ratings') },
        { key: 'webhooks', label: t('settingsPage.tabs.webhooks') },
        { key: 'license', label: t('settingsPage.tabs.license') },
        { key: 'experimental', label: t('settingsPage.tabs.experimental') },
        ...(isDev ? [{ key: 'developer', label: t('settingsPage.tabs.developer') }] : []),
      ],
    },
    ...moduleSettings.map(({ id, labelKey, pages }) => ({
      id,
      label: t(labelKey, { ns: id }),
      entries: pages?.length
        ? pages.map((page) => ({ key: `${id}:${page.key}`, label: t(page.labelKey, { ns: id }) }))
        : [{ key: id, label: t(labelKey, { ns: id }) }],
    })),
  ];
  const entryKeys = groups.flatMap((group) => group.entries.map((entry) => entry.key));
  const requested = searchParams.get('section') ?? '';
  const wanted = SECTION_ALIASES[requested] ?? requested;
  // A module's id opens its first page; a page whose module went away falls back to General.
  const active =
    (entryKeys.includes(wanted) && wanted) ||
    groups.find((group) => group.id === wanted && group.id !== 'platform')?.entries[0]?.key ||
    'general';
  const openPage = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('section', key);
    setSearchParams(next, { replace: true });
  };
  const activeModule = moduleSettings.find(
    ({ id }) => active === id || active.startsWith(`${id}:`)
  );
  const activeModulePage = activeModule && active.includes(':') ? active.slice(activeModule.id.length + 1) : undefined;

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
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '220px minmax(0, 1fr)' },
              gap: { xs: 2, md: 3 },
              alignItems: 'start',
            }}
          >
            {/* Phones: one dropdown, grouped the same way. */}
            <Select
              size="small"
              value={active}
              onChange={(event) => openPage(String(event.target.value))}
              sx={{ display: { xs: 'flex', md: 'none' } }}
              inputProps={{ 'aria-label': t('settingsPage.navLabel'), 'data-testid': 'settings-nav-select' }}
            >
              {groups.flatMap((group) => [
                <ListSubheader key={`group-${group.id}`}>{group.label}</ListSubheader>,
                ...group.entries.map((entry) => (
                  <MenuItem key={entry.key} value={entry.key}>
                    {entry.label}
                  </MenuItem>
                )),
              ])}
            </Select>

            <Box
              component="nav"
              aria-label={t('settingsPage.navLabel')}
              sx={{ display: { xs: 'none', md: 'flex' }, flexDirection: 'column', gap: 2.5, position: 'sticky', top: 16 }}
            >
              {groups.map((group) => (
                <Box key={group.id} data-testid={`settings-nav-group-${group.id}`}>
                  <Typography
                    variant="overline"
                    color="text.secondary"
                    sx={{ display: 'block', px: 1.5, mb: 0.5, lineHeight: 2 }}
                  >
                    {group.label}
                  </Typography>
                  <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                    {group.entries.map((entry) => {
                      const current = entry.key === active;
                      return (
                        <li key={entry.key}>
                          <ButtonBase
                            id={`settings-nav-${entry.key.replace(':', '-')}`}
                            data-testid={`settings-nav-${entry.key.replace(':', '-')}`}
                            aria-current={current ? 'page' : undefined}
                            onClick={() => openPage(entry.key)}
                            sx={{
                              width: '100%',
                              justifyContent: 'flex-start',
                              textAlign: 'left',
                              px: 1.5,
                              py: 0.875,
                              borderRadius: 1.5,
                              fontSize: '0.875rem',
                              fontWeight: current ? 600 : 400,
                              color: current ? 'text.primary' : 'text.secondary',
                              bgcolor: current ? 'action.selected' : 'transparent',
                              '&:hover': { bgcolor: current ? 'action.selected' : 'action.hover', color: 'text.primary' },
                              '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: 1 },
                            }}
                          >
                            {entry.label}
                          </ButtonBase>
                        </li>
                      );
                    })}
                  </Box>
                </Box>
              ))}
            </Box>

            <Paper sx={{ p: { xs: 2, md: 3 }, minWidth: 0 }}>
            {active === 'general' && (
              <SettingsPage pageKey="general">
              <Stack spacing={3}>
                <SiteNameCard />
              </Stack>
              </SettingsPage>
            )}
            {active === 'signin' && (
              <SettingsPage pageKey="signin">
              <SignInProvidersCard welcome={searchParams.get('welcome') === 'setup'} />
              </SettingsPage>
            )}
            {active === 'players' && (
              <SettingsPage pageKey="players">
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
              </SettingsPage>
            )}
            {active === 'ratings' && (
              <SettingsPage pageKey="ratings">
              <Stack spacing={3}>
                <Accordion defaultExpanded sx={ACCORDION_SX}>
                  <AccordionSummary expandIcon={<CaretDownIcon />} sx={ACCORDION_SUMMARY_SX}>
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
              </SettingsPage>
            )}
            {active === 'webhooks' && (
              <SettingsPage pageKey="webhooks">
              <WebhooksCard />
              </SettingsPage>
            )}
            {active === 'license' && (
              <SettingsPage pageKey="license">
              <LicenseCard />
              </SettingsPage>
            )}
            {active === 'experimental' && (
              <SettingsPage pageKey="experimental">
              <ExperimentalCard />
              </SettingsPage>
            )}

            {/* The open module page (CS2: general, servers, skins, player inventories) */}
            {activeModule && (
              <SettingsPage pageKey={active} data-testid={`settings-module-${activeModule.id}`}>
                <activeModule.Section page={activeModulePage} />
              </SettingsPage>
            )}

            {isDev && active === 'developer' && (
              <SettingsPage pageKey="developer">
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
              </SettingsPage>
            )}
            </Paper>
          </Box>

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
