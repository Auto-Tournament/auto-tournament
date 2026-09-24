/**
 * Modules (`/modules`) — what this instance can run, and how to add to it.
 *
 * - **Game modules**: the engines compiled into the app (CS2 while it still
 *   is, manual reporting), listed so an admin can see them, plus code an
 *   operator put on this server's disk by hand (`CodeModuleList`), which can
 *   be enabled and disabled here but never uploaded.
 * - **Games**: the game catalog (DESIGN-modules §10) — every pack and signed
 *   code module this instance has or can install, in one list, installed
 *   with one click from our GitHub or from the copy inside the image.
 *
 * Packs are data, so an admin may also import one from a file (the header
 * button). Code never arrives that way: it is signed, or it is the
 * operator's.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import ExtensionIcon from '@mui/icons-material/Extension';
import { useTranslation } from 'react-i18next';
import { pageTitle } from '../utils/pageTitle';
import { useSnackbar } from '../contexts/SnackbarContext';
import { PageHead } from '../components/common/ui';
import { CodeModuleList } from '../components/modules/CodeModuleList';
import { CatalogTile, GameCatalog } from '../components/catalog/GameCatalog';
import type { CatalogListing } from '../components/catalog/catalogApi';
import { builtInIntegrationIds, listIntegrations } from '../integrations/registry';
import { api, apiErrorMessage } from '../utils/api';

/** The largest pack file worth reading into memory before the API refuses it. */
const MAX_PACK_BYTES = 2_000_000;

export default function Modules() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [catalogModules, setCatalogModules] = useState<ReadonlySet<string>>(new Set());
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = pageTitle(t('modulesPage.title'));
  }, [t]);

  // Modules the catalog shows are managed there, not in the on-disk list too.
  const onListing = useCallback((listing: CatalogListing) => {
    setCatalogModules(
      new Set(
        listing.items
          .filter(
            (item) =>
              item.kind === 'module' &&
              item.state !== 'builtin' &&
              !(item.installed?.source === 'manual' && !item.available)
          )
          .map((item) => item.id)
      )
    );
  }, []);

  /**
   * A pack is a JSON file that *names* its tile — `../icons/rocket-league.svg`
   * — rather than carrying the markup inside it. There is no folder to
   * resolve that against when a file is picked from a disk, so the admin
   * selects both and the page matches them up by name. Picking only the JSON
   * is fine; the game arrives with its text mark.
   */
  const importFiles = async (files: File[]) => {
    const json = files.find((file) => file.name.toLowerCase().endsWith('.json'));
    if (!json) {
      showError(t('modulesPage.import.noJson'));
      return;
    }
    if (files.some((file) => file.size > MAX_PACK_BYTES)) {
      showError(t('modulesPage.import.tooLarge'));
      return;
    }
    setBusy(true);
    try {
      let parsed: { icon?: unknown };
      try {
        parsed = JSON.parse(await json.text()) as { icon?: unknown };
      } catch {
        // A file that is not JSON never reaches the API: the API's answer
        // would be about the body it could not read, which is a worse
        // sentence than "that file is not a pack".
        showError(t('modulesPage.import.notJson'));
        return;
      }

      let icon: string | undefined;
      if (typeof parsed.icon === 'string' && parsed.icon) {
        const wanted = parsed.icon.split('/').pop()?.toLowerCase();
        const svg = files.find((file) => file.name.toLowerCase() === wanted);
        if (!svg) {
          showError(t('modulesPage.import.missingIcon', { file: parsed.icon }));
          return;
        }
        icon = await svg.text();
      }

      const result = await api.post<{ success: boolean; updated: boolean; pack: { name: string } }>(
        '/api/packs',
        { pack: parsed, icon }
      );
      showSuccess(
        result.updated
          ? t('modulesPage.import.updated', { name: result.pack.name })
          : t('modulesPage.import.added', { name: result.pack.name })
      );
      setRefreshKey((key) => key + 1);
    } catch (error) {
      // The API says exactly what is wrong with a pack — "icon contains an
      // onload handler", "engine 'cs2' only runs the games it ships" — and
      // that sentence is the whole value of the refusal. Show it.
      showError(apiErrorMessage(error, t('modulesPage.import.failed')));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const headerActions = (
    <Button
      variant="outlined"
      startIcon={<UploadFileIcon />}
      disabled={busy}
      onClick={() => fileInput.current?.click()}
      data-testid="modules-import"
    >
      {t('modulesPage.import.action')}
    </Button>
  );

  // Only the ones compiled in: a code module that loaded is in the registry
  // too, but it is listed by the catalog or `CodeModuleList` with its own
  // status and switch, not a second time here as "built in".
  const builtIn = builtInIntegrationIds();
  const integrations = listIntegrations().filter((integration) => builtIn.includes(integration.id));

  return (
    <Box data-testid="modules-page" sx={{ width: '100%' }}>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json,image/svg+xml,.svg"
        multiple
        hidden
        data-testid="modules-file-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) void importFiles(files);
        }}
      />

      <Stack spacing={4} sx={{ width: '100%', maxWidth: 1100 }}>
        <PageHead
          title={t('layout.pageTitle.modules')}
          subtitle={t('modulesPage.subheading')}
          actions={headerActions}
          sx={{ mb: 0 }}
        />

        <Box component="section">
          <Typography variant="h6" fontWeight={700} mb={1}>
            {t('catalog.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('catalog.hint')}
          </Typography>
          <GameCatalog onListing={onListing} refreshKey={refreshKey} />
        </Box>

        <Box component="section">
          <Typography variant="h6" fontWeight={700} mb={1}>
            {t('modulesPage.installed.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('modulesPage.installed.hint')}
          </Typography>
          <Stack spacing={1.5} data-testid="modules-installed">
            {integrations.map((integration) => (
              <Card key={integration.id} variant="outlined" data-testid={`module-${integration.id}`}>
                <CardContent
                  sx={{ display: 'flex', gap: 2, alignItems: 'center', '&:last-child': { pb: 2 } }}
                >
                  <CatalogTile src={integration.catalogIcon ?? null} name={integration.id} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography fontWeight={600}>
                      {t(`modulesPage.module.${integration.id}.name`, {
                        defaultValue: integration.id,
                      })}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t(`modulesPage.module.${integration.id}.hint`, { defaultValue: '' })}
                    </Typography>
                  </Box>
                  <Chip size="small" icon={<ExtensionIcon />} label={t('modulesPage.builtIn')} />
                </CardContent>
              </Card>
            ))}
            <CodeModuleList exclude={catalogModules} />
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
}
