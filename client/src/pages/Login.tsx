import { pageTitle } from '../utils/pageTitle';
import React, { useEffect, useState } from 'react';
import { Box, Card, Button, Alert, Container, Link, Stack, Typography } from '@mui/material';
import { OpenInNew as OpenInNewIcon } from '@mui/icons-material';
import { SiDiscord, SiGithub, SiKeycloak } from 'react-icons/si';
import { FcGoogle } from 'react-icons/fc';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { SteamIcon } from '../components/icons/SteamIcon';
import { TopNavBar } from '../components/layout/TopNavBar';
import { tokens } from '../theme/tokens';
import { AtIcon } from '../components/common/AtIcon';

/** Stands for "no sign-in method is available"; rendered as `login.unavailable`. */
const SIGN_IN_UNAVAILABLE = 'sign-in-unavailable';

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

        // If only Steam is configured, keep backwards-compatible behaviour.
        if (enabledProviders.length === 1 && enabledProviders[0].id === 'steam') {
          // no-op here; the primary button below will handle it.
        }
      } catch (error) {
        console.error(error);
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to load sign-in options. Please try again or check server logs.';
        setProvidersError(message);
      } finally {
        setLoadingProviders(false);
      }
    };

    void loadProviders();
  }, []);

  const handleProviderClick = (providerId: string, loginUrl: string) => {
    if (providerId === 'steam') {
      // Use the existing helper so that future changes to the Steam flow are centralized.
      loginWithSteam();
      return;
    }

    window.location.href = loginUrl;
  };

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
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Container maxWidth="xs">
        <Card
          elevation={0}
          sx={{
            p: { xs: 3, sm: 4, md: 5 },
            backgroundColor: 'background.paper',
          }}
        >
          <Stack spacing={4} alignItems="center">
            <Stack spacing={2} alignItems="center" sx={{ width: '100%' }}>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  width: '100%',
                }}
              >
                <Box sx={{ width: '88px', height: '88px', borderRadius: '20px', overflow: 'hidden', display: 'flex' }}>
                  <AtIcon size={88} title="Auto Tournament Logo" />
                </Box>
              </Box>

              <Stack spacing={0.5} alignItems="center" sx={{ textAlign: 'center', px: 2 }}>
                <Typography variant="h5" fontWeight={600}>
                  {t('login.welcome')}
                </Typography>
                <Typography variant="body2" color="text.secondary" maxWidth={320}>
                  {t('login.subtitle')}
                </Typography>
              </Stack>
            </Stack>

            {/* Provider-based sign in (Steam, Keycloak, Discord, etc.) */}
            <Stack spacing={2.5} sx={{ width: '100%' }}>
              {providersError && (
                <Alert severity="error">
                  <Stack spacing={0.5}>
                    <Typography variant="body2">
                      {providersError === SIGN_IN_UNAVAILABLE ? t('login.unavailable') : providersError}
                    </Typography>
                    <Link
                      href="https://docs.autotournament.gg/guides/sign-in"
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{ fontSize: '0.8rem' }}
                    >
                      {t('login.signInGuide')}
                    </Link>
                  </Stack>
                </Alert>
              )}

              <Stack spacing={1.5}>
                {providers.map((provider, index) => {
                  const isSteam = provider.id === 'steam';
                  const isDiscord = provider.id === 'discord';
                  const isGitHub = provider.id === 'github';
                  const isKeycloak = provider.id === 'keycloak';
                  const isGoogle = provider.id === 'google';

                  // Preferred = first enabled provider in the order the API
                  // returns them (Steam today). It always gets the theme's
                  // accent so it follows all themes; everyone else is a
                  // neutral outlined button.
                  const isPreferred = index === 0;

                  const icon = isSteam
                    ? <SteamIcon />
                    : isDiscord
                      ? <SiDiscord />
                      : isGitHub
                        ? <SiGithub />
                        : isGoogle
                          ? <FcGoogle />
                          : isKeycloak
                            ? <SiKeycloak />
                            : undefined;

                  const { variant, color, sx } = (() => {
                    if (isPreferred) {
                      return {
                        variant: 'contained' as const,
                        color: 'primary' as const,
                        sx: undefined,
                      };
                    }

                    // Keycloak keeps its admin-configured colours only when
                    // explicitly set, and only when it isn't the preferred
                    // provider (handled above).
                    if (isKeycloak && provider.buttonBgColor) {
                      const bg = provider.buttonBgColor;
                      const text = provider.buttonTextColor || tokens.brand.onBrand;
                      const hoverBg = provider.buttonHoverBgColor || tokens.brand.keycloakHover;
                      return {
                        variant: 'contained' as const,
                        color: 'inherit' as const,
                        sx: {
                          bgcolor: bg,
                          color: text,
                          '&:hover': {
                            bgcolor: hoverBg,
                          },
                        },
                      };
                    }

                    return {
                      variant: 'outlined' as const,
                      color: 'inherit' as const,
                      sx: undefined,
                    };
                  })();

                  return (
                    <Button
                      key={provider.id}
                      fullWidth
                      size="large"
                      variant={variant}
                      color={color}
                      sx={sx}
                      onClick={() => handleProviderClick(provider.id, provider.loginUrl)}
                      startIcon={icon}
                      disabled={loadingProviders}
                      data-testid={
                        isSteam
                          ? 'login-steam-sign-in-button'
                          : `login-${provider.id}-sign-in-button`
                      }
                    >
                      {provider.buttonLabel || t('login.signInWith', { provider: provider.label })}
                    </Button>
                  );
                })}

                {loadingProviders && providers.length === 0 && (
                  <Button fullWidth size="large" variant="contained" disabled>
                    {t('login.signingIn')}
                  </Button>
                )}
              </Stack>
            </Stack>

            <Stack spacing={1.5} alignItems="center" sx={{ width: '100%' }}>
              <Stack direction="row" spacing={2}>
                <Link
                  href="https://github.com/Auto-Tournament/auto-tournament"
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.5,
                  }}
                >
                  {t('login.github')}
                  <OpenInNewIcon sx={{ fontSize: '1rem' }} />
                </Link>
                <Link
                  href="https://docs.autotournament.gg"
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.5,
                  }}
                >
                  {t('login.documentation')}
                  <OpenInNewIcon sx={{ fontSize: '1rem' }} />
                </Link>
              </Stack>

              <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                {t('login.version')} {appVersion || 'Unknown'}
              </Typography>
            </Stack>
          </Stack>
        </Card>
      </Container>
      </Box>
    </Box>
  );
}
