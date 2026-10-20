import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Stack, Switch, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { apiErrorMessage } from '../../utils/api';
import { paths } from '../../paths';
import { fetchAddons, setAddonEnabled, type AddonView } from '../../addons/addonApi';
import { clientAddon } from '../../addons/registry';

/**
 * Modules → Add-ons: the features beside the games (the Discord bot), each
 * turned on and off here at once, with a link to its own page.
 */
export function AddonList() {
  const { t } = useTranslation();
  const { showError } = useSnackbar();
  const [addons, setAddons] = useState<AddonView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAddons(await fetchAddons());
    } catch {
      setAddons([]);
    }
  }, []);
  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  const toggle = async (addon: AddonView, enabled: boolean) => {
    setBusy(addon.id);
    try {
      const next = await setAddonEnabled(addon.id, enabled);
      setAddons((prev) => prev?.map((a) => (a.id === next.id ? next : a)) ?? null);
    } catch (error) {
      showError(apiErrorMessage(error, t('modulesPage.addons.toggleFailed')));
    } finally {
      setBusy(null);
    }
  };

  if (!addons?.length) return null;
  return (
    <Box component="section" data-testid="modules-addons">
      <Typography variant="h6" fontWeight={700} mb={1}>
        {t('modulesPage.addons.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={2}>
        {t('modulesPage.addons.hint')}
      </Typography>
      <Stack spacing={1.5}>
        {addons.map((addon) => {
          const page = clientAddon(addon.id);
          return (
            <Card key={addon.id} variant="outlined" data-testid={`addon-${addon.id}`}>
              <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography fontWeight={600}>{addon.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {addon.description}
                    </Typography>
                  </Box>
                  {page && addon.enabled && (
                    <Button
                      component={RouterLink}
                      to={`${paths.modules}/${addon.id}`}
                      size="small"
                      data-testid={`addon-open-${addon.id}`}
                    >
                      {t('modulesPage.addons.open')}
                    </Button>
                  )}
                  <Switch
                    checked={addon.enabled}
                    disabled={busy === addon.id}
                    onChange={(e) => void toggle(addon, e.target.checked)}
                    inputProps={{
                      'aria-label': t('modulesPage.addons.toggle', { name: addon.name }),
                    }}
                    data-testid={`addon-toggle-${addon.id}`}
                  />
                </Box>
                {addon.enabled && addon.error && (
                  <Alert severity="error" sx={{ mt: 1.5 }}>
                    {t('modulesPage.addons.startFailed', { error: addon.error })}
                  </Alert>
                )}
              </CardContent>
            </Card>
          );
        })}
      </Stack>
    </Box>
  );
}
