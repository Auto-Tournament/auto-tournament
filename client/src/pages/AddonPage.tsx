import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Alert, Box, Button, Stack } from '@mui/material';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { PageHead } from '../components/common/ui';
import { pageTitle } from '../utils/pageTitle';
import { paths } from '../paths';
import { fetchAddons, type AddonView } from '../addons/addonApi';
import { clientAddon } from '../addons/registry';

/**
 * Modules → <add-on> (`/manage/modules/:id`): one add-on module's own page,
 * which the add-on registers (addons/registry.ts).
 */
export default function AddonPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const [addon, setAddon] = useState<AddonView | null | undefined>(undefined);
  const page = clientAddon(id);

  useEffect(() => {
    let cancelled = false;
    fetchAddons()
      .then((list) => !cancelled && setAddon(list.find((a) => a.id === id) ?? null))
      .catch(() => !cancelled && setAddon(null));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (addon) document.title = pageTitle(addon.name);
  }, [addon]);

  const back = (
    <Button component={RouterLink} to={paths.modules} startIcon={<ArrowLeftIcon />} size="small">
      {t('layout.pageTitle.modules')}
    </Button>
  );

  if (addon === undefined) return null;
  return (
    <Box data-testid="addon-page" sx={{ width: '100%' }}>
      <Stack spacing={3} sx={{ width: '100%', maxWidth: 900 }}>
        <Box>{back}</Box>
        {!addon || !page ? (
          <Alert severity="info" data-testid="addon-page-missing">
            {t('modulesPage.addons.notFound')}
          </Alert>
        ) : (
          <>
            <PageHead title={addon.name} subtitle={addon.description} sx={{ mb: 0 }} />
            {!addon.enabled ? (
              <Alert severity="info" data-testid="addon-page-off">
                {t('modulesPage.addons.off')}
              </Alert>
            ) : (
              <page.Page />
            )}
          </>
        )}
      </Stack>
    </Box>
  );
}
