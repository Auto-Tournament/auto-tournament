import { pageTitle } from '../utils/pageTitle';
import React, { useEffect, useState } from 'react';
import { Box, Card, Button, Alert, CircularProgress, Container, Link, Skeleton, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { paths } from '../paths';
import { BookOpenIcon, GithubLogoIcon, GlobeIcon, ScalesIcon } from '@phosphor-icons/react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { ProviderLogo, hasProviderLogo } from '../components/auth/ProviderLogo';
import { TopNavBar } from '../components/layout/TopNavBar';
import { tokens } from '../theme/tokens';
import { AtIcon } from '../components/common/AtIcon';
import { ExternalLink } from '../components/common/ExternalLink';

/** Stands for "no sign-in method is available"; rendered as `login.unavailable`. */
const SIGN_IN_UNAVAILABLE = 'sign-in-unavailable';
/** The provider list could not be loaded; rendered as `login.loadFailed`. */
const LOAD_FAILED = 'load-failed';

export default function Login() {
  const { t } = useTranslation();
  const { loginWithSteam } = useAuth();
  const [providers, setProviders] = useState<
    Array<{
      id: string;
      label: string;
      loginUrl: string;
      enabled: boolean;
      buttonLabel?: string;
      buttonBgColor?: string;
      buttonTextColor?: string;
      buttonHoverBgColor?: string;
    }>
  >([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const hasLoadedProvidersRef = React.useRef(false);
  // Local admin login (small link) and first-admin setup (/api/auth/local/status).
  const [localLogin, setLocalLogin] = useState<{ enabled: boolean; setup: boolean } | null>(null);

  useEffect(() => {
    void fetch('/api/auth/local/status', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { enabled?: boolean; setup?: boolean } | null) => {
        if (data) setLocalLogin({ enabled: data.enabled === true, setup: data.setup === true });
      })
      .catch(() => undefined);
  }, []);
  // __APP_VERSION__ is injected by Vite at build time (see client/vite.config.ts)
  const appVersion = __APP_VERSION__;

  // Set dynamic page title
  useEffect(() => {
    if (hasLoadedProvidersRef.current) {
      return;
    }
    hasLoadedProvidersRef.current = true;

    document.title = pageTitle(t('login.title'));
  }, [t]);

  useEffect(() => {
    const loadProviders = async () => {
      try {
        setLoadingProviders(true);
        setProvidersError(null);

        const response = await fetch('/api/auth/providers');
        if (!response.ok) {
          throw new Error(`Failed to load auth providers: ${response.status}`);
        }

        const data: {
          success: boolean;
          providers?: Array<{
            id: string;
            label: string;
            loginUrl: string;
            enabled: boolean;
            buttonLabel?: string;
            buttonBgColor?: string;
            buttonTextColor?: string;
            buttonHoverBgColor?: string;
          }>;
          error?: string;
        } = await response.json();

        if (!data || typeof data !== 'object') {
          throw new Error('Invalid auth providers response');
        }

        const providersList = Array.isArray(data.providers) ? data.providers : [];
        const enabledProviders = providersList.filter((p) => p.enabled);
        setProviders(enabledProviders);

        if (!data.success || enabledProviders.length === 0) {
          // The API's reason is English only; the alert says it in the
          // viewer's language instead (see SIGN_IN_UNAVAILABLE below).
          throw new Error(SIGN_IN_UNAVAILABLE);
        }

      } catch (error) {
        console.error(error);
        // The alert says it in the viewer's language; details are in the console.
        setProvidersError(
          error instanceof Error && error.message === SIGN_IN_UNAVAILABLE ? SIGN_IN_UNAVAILABLE : LOAD_FAILED
        );
      } finally {
        setLoadingProviders(false);
      }
    };

    void loadProviders();
  }, []);

  // The provider whose sign-in is under way: its button shows a spinner and
  // the others wait, so a second click can't start another redirect.
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);

  useEffect(() => {
    // Coming back with the browser's Back button restores the page from cache.
    const reset = (event: globalThis.PageTransitionEvent) => {
      if (event.persisted) setPendingProvider(null);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  const handleProviderClick = (providerId: string, loginUrl: string) => {
    setPendingProvider(providerId);
    if (providerId === 'steam') {
      // Use the existing helper so that future changes to the Steam flow are centralized.
      loginWithSteam();
      return;
    }

    window.location.href = loginUrl;
  };

  const footerLinks = [
    { href: 'https://autotournament.gg', label: t('login.website'), Icon: GlobeIcon, testId: 'login-website-link' },
    { href: 'https://docs.autotournament.gg', label: t('login.documentation'), Icon: BookOpenIcon, testId: 'login-docs-link' },
    {
      href: 'https://github.com/Auto-Tournament/auto-tournament',
      label: t('login.github'),
      Icon: GithubLogoIcon,
      testId: 'login-github-link',
    },
  ];

  // Footer links: small text, but a 44px-tall hit area for touch.
  const quietLinkSx = {
    fontSize: '0.8rem',
    whiteSpace: 'nowrap',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0.5,
    minHeight: 44,
    '@media (hover: hover)': { '&:hover': { color: 'text.primary' } },
  } as const;

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        // Transparent: the body carries the paper colour.
        background: 'transparent',
      }}
    >
      <TopNavBar />
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
        <Container maxWidth="xs">
          <Card elevation={0} sx={{ backgroundColor: 'background.paper', overflow: 'hidden' }}>
            <Stack spacing={3.5} sx={{ p: { xs: 3, sm: 4 } }}>
              <Stack direction="row" spacing={2} alignItems="center">
                <Box sx={{ width: 56, height: 56, borderRadius: '14px', overflow: 'hidden', display: 'flex', flexShrink: 0 }}>
                  <AtIcon size={56} title="Auto Tournament Logo" />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography component="h1" variant="h5" fontWeight={700} sx={{ lineHeight: 1.2 }}>
                    {t('login.welcome')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('login.subtitle')}
                  </Typography>
                </Box>
              </Stack>

              {localLogin?.setup && (
                <Alert severity="info" data-testid="login-setup-notice">
                  <Stack spacing={0.5}>
                    <Typography variant="body2">{t('login.setupNotice')}</Typography>
                    <Link component={RouterLink} to={paths.setup} variant="body2" data-testid="login-setup-link">
                      {t('login.setupLink')}
                    </Link>
                  </Stack>
                </Alert>
              )}

              {providersError && !localLogin?.setup && (
                <Alert severity="error" data-testid="login-providers-error">
                  <Stack spacing={0.5}>
                    <Typography variant="body2">
                      {providersError === SIGN_IN_UNAVAILABLE ? t('login.unavailable') : t('login.loadFailed')}
                    </Typography>
                    <ExternalLink href="https://docs.autotournament.gg/guides/sign-in" sx={{ fontSize: '0.8rem' }}>
                      {t('login.signInGuide')}
                    </ExternalLink>
                  </Stack>
                </Alert>
              )}

              {/* One button per provider the API offers, in its order. */}
              <Stack spacing={1.25} aria-busy={loadingProviders || undefined}>
                {providers.map((provider, index) => {
                  // The first provider gets the theme's accent; the rest are outlined.
                  const isPreferred = index === 0;
                  // Keycloak keeps its admin-set colours when it isn't the preferred one.
                  const customKeycloak = !isPreferred && provider.id === 'keycloak' && !!provider.buttonBgColor;
                  const isPending = pendingProvider === provider.id;

                  return (
                    <Button
                      key={provider.id}
                      fullWidth
                      size="large"
                      variant={isPreferred || customKeycloak ? 'contained' : 'outlined'}
                      color={isPreferred ? 'primary' : 'inherit'}
                      onClick={() => handleProviderClick(provider.id, provider.loginUrl)}
                      disabled={loadingProviders || (pendingProvider !== null && !isPending)}
                      aria-busy={isPending || undefined}
                      data-testid={`login-${provider.id}-sign-in-button`}
                      sx={{
                        minHeight: 48,
                        justifyContent: 'flex-start',
                        gap: 1.5,
                        px: 2,
                        // The pending button keeps its look; it just stops taking clicks.
                        ...(isPending && { pointerEvents: 'none' }),
                        ...(!isPreferred && !customKeycloak && { borderColor: 'divider' }),
                        ...(customKeycloak && {
                          bgcolor: provider.buttonBgColor,
                          color: provider.buttonTextColor || tokens.brand.onBrand,
                          '&:hover': { bgcolor: provider.buttonHoverBgColor || tokens.brand.keycloakHover },
                        }),
                      }}
                    >
                      {/* Fixed logo slot, so every label sits in the same place. */}
                      <Box
                        component="span"
                        sx={{ width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                      >
                        {isPending ? (
                          <CircularProgress size={18} color="inherit" aria-hidden />
                        ) : (
                          hasProviderLogo(provider.id) && <ProviderLogo id={provider.id} />
                        )}
                      </Box>
                      <Box component="span" sx={{ flex: 1, textAlign: 'center', pr: '20px', whiteSpace: 'nowrap' }}>
                        {provider.buttonLabel || t('login.signInWith', { provider: provider.label })}
                      </Box>
                    </Button>
                  );
                })}

                {/* The buttons' shape while the list loads. */}
                {loadingProviders &&
                  providers.length === 0 &&
                  [0, 1].map((i) => (
                    <Skeleton key={i} variant="rounded" height={48} sx={{ borderRadius: 999 }} data-testid="login-provider-skeleton" />
                  ))}
              </Stack>
            </Stack>

            <Stack
              component="nav"
              aria-label={t('login.linksLabel')}
              direction="row"
              alignItems="center"
              justifyContent="center"
              columnGap={{ xs: 2, sm: 3 }}
              flexWrap="wrap"
              sx={{ px: 2, py: 0.5, borderTop: 1, borderColor: 'divider' }}
            >
              {footerLinks.map((link) => (
                <ExternalLink
                  key={link.href}
                  href={link.href}
                  hideIcon
                  underline="hover"
                  color="text.secondary"
                  data-testid={link.testId}
                  sx={quietLinkSx}
                >
                  <link.Icon size={14} aria-hidden />
                  {link.label}
                </ExternalLink>
              ))}
            </Stack>
          </Card>

          <Stack direction="row" alignItems="center" justifyContent="center" columnGap={1.5} sx={{ mt: 0.5 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              title={t('login.version')}
              sx={{ fontVariantNumeric: 'tabular-nums' }}
              data-testid="login-version"
            >
              {appVersion ? `v${appVersion}` : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary" aria-hidden>
              ·
            </Typography>
            <ExternalLink
              href="https://docs.autotournament.gg/reference/licensing"
              hideIcon
              underline="hover"
              color="text.secondary"
              data-testid="login-license-link"
              sx={{ ...quietLinkSx, fontSize: '0.75rem' }}
            >
              <ScalesIcon size={13} aria-hidden />
              {t('login.license')}
            </ExternalLink>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}
