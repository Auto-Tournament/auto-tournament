/**
 * Modules (`/modules`) — what this instance can run, and how to add to it.
 *
 * Two lists, because there are two kinds of thing here and conflating them
 * would be a lie:
 *
 * - **Modules** are code. CS2 reads rounds off a game server; manual
 *   reporting takes a captain's word for the result. They ship with the app
 *   and this page shows them so an admin can see what is installed, not so
 *   they can change it.
 * - **Game packs** are files. A pack describes a game — a name, a tile, the
 *   settings a reported game needs — and runs on one of the modules above.
 *   Nothing in a pack executes, which is why an admin can import one from
 *   anywhere and why this page has an upload button at all.
 *
 * The distinction is the whole design (see `brand/DESIGN-modules.md`): the
 * long tail of games needs no code, so adding one should not need a release.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExtensionIcon from '@mui/icons-material/Extension';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../contexts/SnackbarContext';
import { usePageHeader } from '../contexts/PageHeaderContext';
import { ModuleIcon } from '../components/common/ModuleIcon';
import { listIntegrations } from '../integrations/registry';
import { api } from '../utils/api';

interface InstalledPack {
  slug: string;
  name: string;
  engine: string;
  version: string | null;
  source: 'uploaded' | 'index';
  hasIcon: boolean;
  installedAt: number;
  description: string | null;
  statFieldCount: number;
}

interface IndexEntry {
  slug: string;
  name: string;
  version: string | null;
  engine: string;
  description: string | null;
  installed: boolean;
  updatable: boolean;
}

/** The largest pack file worth reading into memory before the API refuses it. */
const MAX_PACK_BYTES = 2_000_000;

function packIconPath(slug: string): string {
  return `/api/packs/${encodeURIComponent(slug)}/icon.svg`;
}

/**
 * The sentence behind a refusal.
 *
 * `api.fetch` throws with the response body as-is, which for this API is
 * `{"success":false,"error":"icon contains an onload handler"}`. That error
 * is the entire value of refusing a pack rather than quietly fixing it, and
 * it should reach the admin as a sentence rather than as a JSON blob.
 */
function reason(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  try {
    const body = JSON.parse(error.message) as { error?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) return body.error;
  } catch {
    // Not JSON: a proxy error, or a message this file threw itself.
  }
  return error.message || fallback;
}

/** One square tile, or the game's initials when it has no art of its own. */
function Tile({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();

  return (
    <Box
      aria-hidden="true"
      sx={{
        width: 56,
        height: 56,
        flex: '0 0 auto',
        borderRadius: 1.5,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'action.hover',
        fontWeight: 700,
      }}
    >
      {src && !failed ? <ModuleIcon src={src} onError={() => setFailed(true)} /> : initials}
    </Box>
  );
}

export default function Modules() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const { setHeaderActions } = usePageHeader();
  const [packs, setPacks] = useState<InstalledPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<InstalledPack | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [index, setIndex] = useState<IndexEntry[] | null>(null);
  const [indexStale, setIndexStale] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = t('modulesPage.title');
  }, [t]);

  const refresh = useCallback(async () => {
    try {
      const response = await api.get<{ success: boolean; packs: InstalledPack[] }>('/api/packs');
      setPacks(response.packs ?? []);
    } catch (error) {
      showError(reason(error, t('modulesPage.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [showError, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importFile = async (file: File) => {
    if (file.size > MAX_PACK_BYTES) {
      showError(t('modulesPage.import.tooLarge'));
      return;
    }
    setBusy(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        // A file that is not JSON never reaches the API: the API's answer
        // would be about the body it could not read, which is a worse
        // sentence than "that file is not a pack".
        showError(t('modulesPage.import.notJson'));
        return;
      }
      const result = await api.post<{ success: boolean; updated: boolean; pack: { name: string } }>(
        '/api/packs',
        parsed
      );
      showSuccess(
        result.updated
          ? t('modulesPage.import.updated', { name: result.pack.name })
          : t('modulesPage.import.added', { name: result.pack.name })
      );
      await refresh();
    } catch (error) {
      // The API says exactly what is wrong with a pack — "icon contains an
      // onload handler", "engine 'cs2' only runs the games it ships" — and
      // that sentence is the whole value of the refusal. Show it.
      showError(reason(error, t('modulesPage.import.failed')));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const remove = async (pack: InstalledPack) => {
    setBusy(true);
    try {
      await api.delete(`/api/packs/${encodeURIComponent(pack.slug)}`);
      showSuccess(t('modulesPage.removed', { name: pack.name }));
      await refresh();
    } catch (error) {
      showError(reason(error, t('modulesPage.removeFailed')));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  /**
   * Nothing is fetched until this runs. A self-hosted instance should not
   * contact the pack index — or anywhere else — before the person running it
   * asks it to, so the list is loaded when Browse is opened and not before.
   */
  const openBrowse = async () => {
    setBrowsing(true);
    setIndex(null);
    setIndexStale(null);
    try {
      const response = await api.get<{
        entries: IndexEntry[];
        stale: boolean;
        error?: string;
      }>('/api/packs/index');
      setIndex(response.entries ?? []);
      setIndexStale(response.stale ? response.error || t('modulesPage.browse.offline') : null);
    } catch (error) {
      setIndex([]);
      setIndexStale(reason(error, t('modulesPage.browse.failed')));
    }
  };

  const installFromIndex = async (entry: IndexEntry) => {
    setBusy(true);
    try {
      const result = await api.post<{ updated: boolean; pack: { name: string } }>(
        `/api/packs/index/${encodeURIComponent(entry.slug)}`
      );
      showSuccess(
        result.updated
          ? t('modulesPage.import.updated', { name: result.pack.name })
          : t('modulesPage.import.added', { name: result.pack.name })
      );
      await refresh();
      await openBrowse();
    } catch (error) {
      showError(reason(error, t('modulesPage.import.failed')));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setHeaderActions(
      <Stack direction="row" spacing={1}>
        <Button
          variant="outlined"
          startIcon={<TravelExploreIcon />}
          disabled={busy}
          onClick={() => void openBrowse()}
          data-testid="modules-browse"
        >
          {t('modulesPage.browse.action')}
        </Button>
        <Button
          variant="contained"
          startIcon={<UploadFileIcon />}
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          data-testid="modules-import"
        >
          {t('modulesPage.import.action')}
        </Button>
      </Stack>
    );
    return () => setHeaderActions(null);
    // `openBrowse` is redefined every render; the button only needs to be
    // rebuilt when it changes from enabled to disabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, setHeaderActions, t]);

  const integrations = listIntegrations();

  return (
    <Box data-testid="modules-page" sx={{ width: '100%' }}>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        data-testid="modules-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
        }}
      />

      <Stack spacing={4} sx={{ width: '100%', maxWidth: 1100 }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            {t('modulesPage.heading')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('modulesPage.subheading')}
          </Typography>
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
                  <Tile src={integration.catalogIcon ?? null} name={integration.id} />
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
          </Stack>
        </Box>

        <Box component="section">
          <Typography variant="h6" fontWeight={700} mb={1}>
            {t('modulesPage.packs.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('modulesPage.packs.hint')}
          </Typography>

          {loading ? (
            <LinearProgress />
          ) : packs.length === 0 ? (
            <Alert severity="info" data-testid="modules-packs-empty">
              {t('modulesPage.packs.empty')}
            </Alert>
          ) : (
            <Stack spacing={1.5} data-testid="modules-packs">
              {packs.map((pack) => (
                <Card key={pack.slug} variant="outlined" data-testid={`pack-${pack.slug}`}>
                  <CardContent
                    sx={{ display: 'flex', gap: 2, alignItems: 'center', '&:last-child': { pb: 2 } }}
                  >
                    <Tile src={pack.hasIcon ? packIconPath(pack.slug) : null} name={pack.name} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography fontWeight={600}>{pack.name}</Typography>
                        {pack.version && <Chip size="small" label={pack.version} />}
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {pack.description ||
                          t('modulesPage.packs.runBy', { engine: pack.engine })}
                      </Typography>
                    </Box>
                    <Button
                      color="error"
                      size="small"
                      startIcon={<DeleteOutlineIcon />}
                      disabled={busy}
                      onClick={() => setConfirming(pack)}
                      data-testid={`pack-${pack.slug}-remove`}
                    >
                      {t('common.remove')}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}
        </Box>
      </Stack>

      <Dialog
        open={browsing}
        onClose={() => setBrowsing(false)}
        fullWidth
        maxWidth="sm"
        data-testid="modules-browse-dialog"
      >
        <DialogTitle>{t('modulesPage.browse.title')}</DialogTitle>
        <DialogContent dividers>
          <DialogContentText sx={{ mb: 2 }}>{t('modulesPage.browse.hint')}</DialogContentText>
          {indexStale && (
            <Alert severity="warning" sx={{ mb: 2 }} data-testid="modules-browse-stale">
              {t('modulesPage.browse.staleWith', { reason: indexStale })}
            </Alert>
          )}
          {index === null ? (
            <LinearProgress />
          ) : index.length === 0 ? (
            <Alert severity="info" data-testid="modules-browse-empty">
              {t('modulesPage.browse.empty')}
            </Alert>
          ) : (
            <Stack spacing={1.5}>
              {index.map((entry) => (
                <Card key={entry.slug} variant="outlined" data-testid={`index-${entry.slug}`}>
                  <CardContent
                    sx={{
                      display: 'flex',
                      gap: 2,
                      alignItems: 'center',
                      '&:last-child': { pb: 2 },
                    }}
                  >
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography fontWeight={600}>{entry.name}</Typography>
                        {entry.version && <Chip size="small" label={entry.version} />}
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {entry.description ||
                          t('modulesPage.packs.runBy', { engine: entry.engine })}
                      </Typography>
                    </Box>
                    {entry.installed && !entry.updatable ? (
                      <Chip size="small" label={t('modulesPage.browse.installed')} />
                    ) : (
                      <Button
                        size="small"
                        variant={entry.updatable ? 'outlined' : 'contained'}
                        disabled={busy}
                        onClick={() => void installFromIndex(entry)}
                        data-testid={`index-${entry.slug}-add`}
                      >
                        {entry.updatable
                          ? t('modulesPage.browse.update')
                          : t('modulesPage.browse.add')}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBrowsing(false)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(confirming)} onClose={() => setConfirming(null)}>
        <DialogTitle>{t('modulesPage.confirmRemove.title', { name: confirming?.name })}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('modulesPage.confirmRemove.body')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)}>{t('common.cancel')}</Button>
          <Button
            color="error"
            disabled={busy}
            onClick={() => confirming && void remove(confirming)}
            data-testid="modules-confirm-remove"
          >
            {t('common.remove')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
