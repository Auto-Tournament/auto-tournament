import { pageTitle } from '../utils/pageTitle';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { PageHead, Panel } from '../components/common/ui';
import { useSnackbar } from '../contexts/SnackbarContext';
import {
  Box,
  Typography,
  Stack,
  Button,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import Switch from '@mui/material/Switch';
import { api } from '../utils/api';
import type { SettingsResponse } from '../types/api.types';
import { useIsDevelopment } from '../hooks/useIsDevelopment';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { SiteNameCard } from '../components/settings/SiteNameCard';
import { LicenseCard } from '../components/settings/LicenseCard';
import { WebhooksCard } from '../components/settings/WebhooksCard';
import { ExperimentalCard } from '../components/settings/ExperimentalCard';
import { SignInProvidersCard } from '../components/settings/SignInProvidersCard';
import { SettingsCardHead, SettingsRow } from '../components/settings/SettingsRow';
import { useInstalledIntegrations } from '../integrations/registry';
import { moduleNavItems, navItemLabel } from '../utils/moduleNavLabels';
import { tokens, radii } from '../theme/tokens';

declare const __APP_VERSION__: string | undefined;

const { color } = tokens;

/**
 * `?section=` values, old and new, to the card they open. Settings was a page
 * per section with a nav beside it; it is one page now, and a section scrolls
 * to its card (bookmarks, links in docs, `SIGN_IN_SETTINGS_PATH`).
 */
const SECTION_CARDS: Record<string, string> = {
  general: 'site',
  integrations: 'site',
  site: 'site',
  signin: 'signin',
  players: 'players',
  ratings: 'players',
  matches: 'players',
  webhooks: 'webhooks',
  license: 'license',
  experimental: 'advanced',
  developer: 'advanced',
  advanced: 'advanced',
};

/**
 * CS2's settings moved out of Settings to its own pages in the admin menu
 * (Skins, Match rules); its old sections, and `links.settings('cs2')`, go there.
 */
const MOVED_SECTIONS: Record<string, string> = {
  cs2: '/match-rules',
  'cs2:general': '/match-rules',
  'cs2:servers': '/match-rules',
  skins: '/skins',
  'cs2:skins': '/skins',
  'cs2:inventories': '/skins',
};

/** One card on the page, found by `?section=` (`settings-<key>`). */
function SettingsCard({ cardKey, children, highlight }: { cardKey: string; children: React.ReactNode; highlight: boolean }) {
  return (
    <Panel
      component="section"
      id={`settings-${cardKey}`}
      data-testid={`settings-card-${cardKey}`}
      sx={{
        p: { xs: 2, md: 3 },
        minWidth: 0,
        scrollMarginTop: 96,
        transition: 'border-color 600ms',
        borderColor: highlight ? color.accent : color.rule,
      }}
    >
      {children}
    </Panel>
  );
}

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
 * Settings: the platform's own, on one page of cards (site, sign-in, players,
 * webhooks, license, advanced). A game's settings are its own pages in the
 * admin menu (CS2: Skins, Match rules), linked at the bottom.
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

  // `?section=` scrolls to that card; CS2's old sections open its own pages.
  // Modules other than CS2 that still have `instanceSettings` get a card
  // each at the end, found by their id.
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const installed = useInstalledIntegrations();
  const moduleSettings = installed.flatMap((integration) =>
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
  const gameLinks = moduleNavItems(installed);
  const requested = searchParams.get('section') ?? '';
  const moved = MOVED_SECTIONS[requested];
  const target = SECTION_CARDS[requested] ?? (moduleSettings.some(({ id }) => requested === id || requested.startsWith(`${id}:`)) ? requested.split(':')[0] : '');
  const [highlight, setHighlight] = useState('');

  useEffect(() => {
    if (moved) navigate(moved, { replace: true });
  }, [moved, navigate]);

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

  useEffect(() => {
    if (loading || !target) return;
    document.getElementById(`settings-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setHighlight(target);
    const timer = setTimeout(() => setHighlight(''), 1600);
    return () => clearTimeout(timer);
  }, [loading, target]);

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      <PageHead title={t('layout.pageTitle.settings')} subtitle={t('settingsPage.intro')} />

      {loading && (
        <LinearProgress />
      )}

      {!loading && (
        <>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' },
              gap: 2,
              alignItems: 'start',
            }}
          >
            <Stack spacing={2} sx={{ minWidth: 0 }}>
              <SettingsCard cardKey="site" highlight={highlight === 'site'}>
                <SiteNameCard />
              </SettingsCard>
              <SettingsCard cardKey="signin" highlight={highlight === 'signin'}>
                <SignInProvidersCard welcome={searchParams.get('welcome') === 'setup'} />
              </SettingsCard>
              <SettingsCard cardKey="players" highlight={highlight === 'players'}>
                <SettingsCardHead title={t('settingsPage.players.title')} hint={t('settingsPage.players.short')} />
                <SettingsRow
                  title={t('settingsPage.players.registration.toggleLabel')}
                  sub={t('settingsPage.players.registration.short')}
                  control={
                    <Switch
                      checked={values.allowSelfRegister}
                      onChange={(event) => setValues((prev) => ({ ...prev, allowSelfRegister: event.target.checked }))}
                      inputProps={{ 'aria-label': t('settingsPage.players.registration.toggleLabel'), 'data-testid': 'settings-self-register' } as Record<string, string>}
                    />
                  }
                />
                <SettingsRow
                  title={t('settingsPage.matchRating.ratings.toggleLabel')}
                  sub={t('settingsPage.matchRating.ratings.short')}
                  control={
                    <Switch
                      checked={values.ratingsEnabled}
                      onChange={(event) => setValues((prev) => ({ ...prev, ratingsEnabled: event.target.checked }))}
                      inputProps={{ 'aria-label': t('settingsPage.matchRating.ratings.toggleLabel'), 'data-testid': 'settings-ratings-enabled' } as Record<string, string>}
                    />
                  }
                />
              </SettingsCard>
            </Stack>

            <Stack spacing={2} sx={{ minWidth: 0 }}>
              <SettingsCard cardKey="webhooks" highlight={highlight === 'webhooks'}>
                <WebhooksCard />
              </SettingsCard>
              <SettingsCard cardKey="license" highlight={highlight === 'license'}>
                <LicenseCard />
              </SettingsCard>
              <SettingsCard cardKey="advanced" highlight={highlight === 'advanced'}>
                <ExperimentalCard />
                {isDev && (
                  <Box sx={{ mt: 3, pt: 3, borderTop: `1px solid ${color.rule}` }} data-testid="settings-developer">
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
                )}
              </SettingsCard>
            </Stack>
          </Box>

          {/* Modules that still keep settings here: a card each. */}
          {moduleSettings.map(({ id, labelKey, pages, Section }) => (
            <SettingsCard key={id} cardKey={id} highlight={highlight === id}>
              <Box data-testid={`settings-module-${id}`}>
                <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                  {t(labelKey, { ns: id })}
                </Typography>
                {pages?.length ? (
                  <Stack spacing={3}>
                    {pages.map((page) => (
                      <Section key={page.key} page={page.key} />
                    ))}
                  </Stack>
                ) : (
                  <Section />
                )}
              </Box>
            </SettingsCard>
          ))}

          {/* Each game's own settings sit with the game in the admin menu. */}
          {gameLinks.length > 0 && (
            <Box
              data-testid="settings-game-links"
              sx={{
                mt: 2,
                border: `1px dashed ${color.rule}`,
                borderRadius: radii.lg,
                p: { xs: 2, md: 2.5 },
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 2,
                flexWrap: 'wrap',
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600 }}>{t('settingsPage.gameLinks.title')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('settingsPage.gameLinks.hint')}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {gameLinks.map((item) => (
                  <Button
                    key={`${item.moduleId}-${item.key}`}
                    component={RouterLink}
                    to={item.path}
                    size="small"
                    sx={{ borderRadius: radii.pill, bgcolor: color.paper3, color: color.ink, px: 2 }}
                  >
                    {navItemLabel(t, item, 'rail')}
                  </Button>
                ))}
              </Box>
            </Box>
          )}

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
