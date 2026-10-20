import { DiscordBotLinkCard } from '../components/settings/DiscordBotLinkCard';
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
import { EmailSettingsCard } from '../components/settings/EmailSettingsCard';
import { ApiTokensCard } from '../components/settings/ApiTokensCard';
import { WebhooksCard } from '../components/settings/WebhooksCard';
import { MatchmakingSettingsCard } from '../components/settings/MatchmakingSettingsCard';
import { AdminNoticesCard } from '../components/settings/AdminNoticesCard';
import { NewsSettingsCard } from '../components/settings/NewsSettingsCard';
import {
  ExperimentalCard,
  type ExperimentalFeatureState,
} from '../components/settings/ExperimentalCard';
import { SignInProvidersCard } from '../components/settings/SignInProvidersCard';
import { SettingsCardHead, SettingsRow } from '../components/settings/SettingsRow';
import { useInstalledIntegrations } from '../integrations/registry';
import { moduleNavItems, navItemLabel } from '../utils/moduleNavLabels';
import { tokens, radii } from '../theme/tokens';

declare const __APP_VERSION__: string | undefined;

const { color } = tokens;

/**
 * `?section=` values, old and new, to the section they open (bookmarks,
 * links in docs, `SIGN_IN_SETTINGS_PATH`). Settings is a list of sections
 * beside the one that is open, as on the SettingsIA board.
 */
const SECTION_CARDS: Record<string, string> = {
  general: 'site',
  site: 'site',
  signin: 'signin',
  email: 'email',
  players: 'players',
  ratings: 'players',
  matches: 'players',
  webhooks: 'webhooks',
  integrations: 'webhooks',
  apitokens: 'apitokens',
  'api-tokens': 'apitokens',
  tokens: 'apitokens',
  matchmaking: 'matchmaking',
  news: 'news',
  adminNotices: 'adminnotices',
  adminnotices: 'adminnotices',
  notifications: 'adminnotices',
  experimental: 'advanced',
  developer: 'advanced',
  advanced: 'advanced',
};

/**
 * CS2's settings moved out of Settings to its own pages in the admin menu
 * (Skins, Match rules); its old sections, and `links.settings('cs2')`, go there.
 */
const MOVED_SECTIONS: Record<string, string> = {
  // The license has its own page now.
  license: '/manage/license',
  cs2: '/manage/match-rules',
  'cs2:general': '/manage/match-rules',
  'cs2:servers': '/manage/match-rules',
  skins: '/manage/skins',
  'cs2:skins': '/manage/skins',
  'cs2:inventories': '/manage/skins',
};

/** The open section's card (`settings-<key>`). */
function SettingsCard({ cardKey, children }: { cardKey: string; children: React.ReactNode }) {
  return (
    <Panel
      component="section"
      id={`settings-${cardKey}`}
      data-testid={`settings-card-${cardKey}`}
      sx={{
        p: { xs: 2, md: 3 },
        minWidth: 0,
        borderColor: color.rule,
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
  playersChooseName: boolean;
}

const CORE_KEYS = ['ratingsEnabled', 'allowSelfRegister', 'playersChooseName'] as const;

function coreSettingsFrom(settings: SettingsResponse['settings'] | undefined): CoreSettings {
  return {
    ratingsEnabled: settings?.ratingsEnabled ?? true,
    allowSelfRegister: settings?.allowSelfRegister ?? false,
    playersChooseName: settings?.playersChooseName ?? false,
  };
}

/**
 * Settings: the platform's own, as on the SettingsIA board. A list of
 * sections (Site, Sign-in, Email, Players, Matchmaking, News, Notifications,
 * Integrations, Advanced) beside the one that is open; `?section=` picks it.
 * A game's settings are its own pages in the admin menu (CS2: Skins, Match
 * rules), linked under the list.
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
  // Experimental features (none right now): the Advanced card shows only with some, or in development.
  const [experimental, setExperimental] = useState<ExperimentalFeatureState[]>([]);
  useEffect(() => {
    api
      .get<{ features: ExperimentalFeatureState[] }>('/api/experimental')
      .then((res) => setExperimental(res.features))
      .catch(() => setExperimental([]));
  }, []);

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
  const target =
    SECTION_CARDS[requested] ??
    (moduleSettings.some(({ id }) => requested === id || requested.startsWith(`${id}:`))
      ? requested.split(':')[0]
      : '');

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

  // The sections, in the SettingsIA board's order. Advanced shows only with
  // an experimental feature to turn on, or in development.
  const playersCard = (
    <>
      <SettingsCardHead
        title={t('settingsPage.players.title')}
        hint={t('settingsPage.players.short')}
      />
      <SettingsRow
        title={t('settingsPage.players.registration.toggleLabel')}
        sub={t('settingsPage.players.registration.short')}
        control={
          <Switch
            checked={values.allowSelfRegister}
            onChange={(event) =>
              setValues((prev) => ({ ...prev, allowSelfRegister: event.target.checked }))
            }
            slotProps={{
              input: {
                'aria-label': t('settingsPage.players.registration.toggleLabel'),
                'data-testid': 'settings-self-register',
              } as React.InputHTMLAttributes<HTMLInputElement>,
            }}
          />
        }
      />
      <SettingsRow
        title={t('settingsPage.players.chooseName.toggleLabel')}
        sub={t('settingsPage.players.chooseName.short')}
        control={
          <Switch
            checked={values.playersChooseName}
            onChange={(event) =>
              setValues((prev) => ({ ...prev, playersChooseName: event.target.checked }))
            }
            slotProps={{
              input: {
                'aria-label': t('settingsPage.players.chooseName.toggleLabel'),
                'data-testid': 'settings-players-choose-name',
              } as React.InputHTMLAttributes<HTMLInputElement>,
            }}
          />
        }
      />
      <SettingsRow
        title={t('settingsPage.matchRating.ratings.toggleLabel')}
        sub={t('settingsPage.matchRating.ratings.short')}
        control={
          <Switch
            checked={values.ratingsEnabled}
            onChange={(event) =>
              setValues((prev) => ({ ...prev, ratingsEnabled: event.target.checked }))
            }
            slotProps={{
              input: {
                'aria-label': t('settingsPage.matchRating.ratings.toggleLabel'),
                'data-testid': 'settings-ratings-enabled',
              } as React.InputHTMLAttributes<HTMLInputElement>,
            }}
          />
        }
      />
    </>
  );
  const advancedCard = (
    <>
      <ExperimentalCard features={experimental} onChange={setExperimental} />
      {isDev && (
        <Box
          sx={
            experimental.length > 0
              ? { mt: 3, pt: 3, borderTop: `1px solid ${color.rule}` }
              : undefined
          }
          data-testid="settings-developer"
        >
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
    </>
  );
  const sections: { key: string; name: string; hint: string; body: React.ReactNode }[] = [
    { key: 'site', body: <SiteNameCard /> },
    {
      key: 'signin',
      body: <SignInProvidersCard welcome={searchParams.get('welcome') === 'setup'} />,
    },
    { key: 'email', body: <EmailSettingsCard /> },
    { key: 'players', body: playersCard },
    { key: 'matchmaking', body: <MatchmakingSettingsCard /> },
    { key: 'news', body: <NewsSettingsCard /> },
    { key: 'adminnotices', body: <AdminNoticesCard /> },
    {
      key: 'webhooks',
      body: (
        <>
          <WebhooksCard />
          <DiscordBotLinkCard />
        </>
      ),
    },
    { key: 'apitokens', body: <ApiTokensCard /> },
    ...(isDev || experimental.length > 0 ? [{ key: 'advanced', body: advancedCard }] : []),
  ].map((section) => ({
    ...section,
    name: t(`settingsPage.sections.${section.key}.name`),
    hint: t(`settingsPage.sections.${section.key}.hint`),
  }));
  // Modules that still keep settings here: a section each.
  for (const { id, labelKey, pages, Section } of moduleSettings) {
    sections.push({
      key: id,
      name: t(labelKey, { ns: id }),
      hint: t('settingsPage.sections.module.hint'),
      body: (
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
      ),
    });
  }
  const open = sections.find((section) => section.key === target) ?? sections[0];

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      <PageHead title={t('layout.pageTitle.settings')} subtitle={t('settingsPage.intro')} />

      {loading && <LinearProgress />}

      {!loading && (
        <>
          <Box
            sx={{
              display: 'grid',
              gap: 3,
              gridTemplateColumns: 'minmax(0, 1fr)',
              alignItems: 'start',
              '@media (min-width: 900px)': { gridTemplateColumns: '220px minmax(0, 1fr)' },
            }}
          >
            <Box
              sx={{
                display: 'grid',
                gap: 2,
                '@media (min-width: 900px)': { position: 'sticky', top: 24 },
              }}
            >
              {/* The sections: a link each, with what it holds. */}
              <Box
                component="nav"
                aria-label={t('settingsPage.sections.label')}
                data-testid="settings-sections"
                sx={{
                  display: 'flex',
                  gap: 0.25,
                  overflowX: 'auto',
                  '@media (min-width: 900px)': { flexDirection: 'column', overflowX: 'visible' },
                }}
              >
                {sections.map((section) => {
                  const current = section.key === open.key;
                  return (
                    <Box
                      key={section.key}
                      component={RouterLink}
                      to={`?section=${section.key}`}
                      replace
                      aria-current={current ? 'page' : undefined}
                      data-testid={`settings-section-${section.key}`}
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.25,
                        flex: 'none',
                        px: 1.5,
                        py: 1.25,
                        borderRadius: radii.md,
                        textDecoration: 'none',
                        bgcolor: current ? color.paper2 : 'transparent',
                        '&:hover': { bgcolor: color.paper2 },
                        '&:focus-visible': {
                          outline: `2px solid ${color.focus}`,
                          outlineOffset: 2,
                        },
                      }}
                    >
                      <Box
                        component="span"
                        sx={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: current ? color.ink : color.ink2,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {section.name}
                      </Box>
                      <Box
                        component="span"
                        sx={{
                          fontSize: 12,
                          color: color.muted,
                          display: 'none',
                          '@media (min-width: 900px)': { display: 'block' },
                        }}
                      >
                        {section.hint}
                      </Box>
                    </Box>
                  );
                })}
              </Box>

              {/* Each game's own settings sit with the game in the admin menu. */}
              {gameLinks.length > 0 && (
                <Box
                  data-testid="settings-game-links"
                  sx={{
                    border: `1px dashed ${color.rule}`,
                    borderRadius: radii.md,
                    p: 1.5,
                    display: 'grid',
                    gap: 1,
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600, fontSize: 14 }}>
                      {t('settingsPage.gameLinks.title')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
                      {t('settingsPage.gameLinks.hint')}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                    {gameLinks.map((item) => (
                      <Button
                        key={`${item.moduleId}-${item.key}`}
                        component={RouterLink}
                        to={item.path}
                        size="small"
                        sx={{
                          borderRadius: radii.pill,
                          bgcolor: color.paper3,
                          color: color.ink,
                          px: 1.5,
                        }}
                      >
                        {navItemLabel(t, item, 'rail')}
                      </Button>
                    ))}
                  </Box>
                </Box>
              )}

              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ px: 1.5, fontSize: 12 }}
                data-testid="settings-version"
              >
                {t('settingsPage.footer.version')}{' '}
                {typeof __APP_VERSION__ !== 'undefined'
                  ? __APP_VERSION__
                  : t('settingsPage.footer.unknownVersion')}
              </Typography>
            </Box>

            <SettingsCard cardKey={open.key}>{open.body}</SettingsCard>
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
