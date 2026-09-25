/**
 * The game catalog (DESIGN-modules §10): every game this instance runs or can
 * add, packs and code modules in one list, with one-click install, update,
 * enable, disable and uninstall. Used on the Modules page and, for admins, on
 * `/welcome/games`.
 *
 * Code modules install only as releases signed by Auto Tournament — from our
 * GitHub, or the copy inside this image when there is no network — so the
 * confirm dialog says what it is and where it comes from, but asks for no
 * typed id: that is for code an operator put on disk by hand
 * (`CodeModuleList`), which nothing has vouched for.
 *
 * States a row can be in: available, installing (this browser is waiting),
 * installed, update available, disabled, broken or incompatible (with the
 * server's reason), failed (the last operation's reason, until the next one),
 * and restart required (the running server differs from what is installed).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  InputAdornment,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CodeIcon from '@mui/icons-material/Code';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { ModuleIcon } from '../common/ModuleIcon';
import { listIntegrations } from '../../integrations/registry';
import { apiErrorMessage } from '../../utils/api';
import {
  fetchCatalog,
  runCatalogAction,
  runCatalogUpdateAll,
  type CatalogAction,
  type CatalogItem,
  type CatalogListing,
  type CatalogState,
  type CatalogUpdateAllResult,
} from './catalogApi';
import { RestartNowButton } from './RestartNowButton';

/** A section's open/closed state, kept per browser. Never throws: private windows and blocked storage just fall back to the default. */
function readSectionOpen(id: string): boolean | null {
  try {
    const raw = window.localStorage.getItem(`at.catalog.section.${id}`);
    return raw === null ? null : raw === '1';
  } catch {
    return null;
  }
}

function writeSectionOpen(id: string, open: boolean): void {
  try {
    window.localStorage.setItem(`at.catalog.section.${id}`, open ? '1' : '0');
  } catch {
    // Private window, or storage blocked: the preference just does not stick.
  }
}

const STATE_COLOR: Record<CatalogState, 'default' | 'success' | 'info' | 'warning' | 'error'> = {
  available: 'default',
  installed: 'success',
  'update-available': 'info',
  disabled: 'default',
  broken: 'error',
  incompatible: 'warning',
  builtin: 'default',
};

/** Show a search box once the list is longer than this. */
const SEARCH_FROM = 8;
/** While the server is still fetching the feed, list again this often, this many times. */
const FEED_REFRESH_DELAY_MS = 3000;
const FEED_REFRESH_TRIES = 3;
/** Reason codes with their own sentence under `catalog.feed.reason`, besides `http_<status>`. */
const FEED_REASONS = ['timeout', 'unreachable', 'bad_response', 'newer_schema', 'too_large', 'offline'];

/**
 * The banner over a catalog whose feed is not fresh. The API gives a reason
 * code, never a sentence, so every word here is translated.
 */
function feedMessage(t: TFunction, feed: CatalogListing['feed'], language: string): string {
  const code = feed.error ?? '';
  const http = /^http_(\d{3})$/.exec(code);
  const reason = http
    ? t('catalog.feed.reason.http', { status: http[1] })
    : FEED_REASONS.includes(code)
      ? t(`catalog.feed.reason.${code}`)
      : t('catalog.feed.unknown');
  if (feed.from === 'cache') {
    const at = feed.fetchedAt ? new Date(feed.fetchedAt) : null;
    const time =
      at && !Number.isNaN(at.getTime())
        ? at.toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' })
        : t('catalog.feed.unknown');
    return t(feed.refreshing ? 'catalog.feed.cacheRefreshing' : 'catalog.feed.cache', { time, reason });
  }
  return t(feed.refreshing ? 'catalog.feed.noneRefreshing' : 'catalog.feed.none', { reason });
}

/** One square tile, or the game's initials when it has no art of its own. */
export function CatalogTile({ src, name, size = 56 }: { src: string | null; name: string; size?: number }) {
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
        width: size,
        height: size,
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

function isInstalled(item: CatalogItem): boolean {
  return item.installed !== null;
}

interface GameCatalogProps {
  /**
   * Show modules compiled into the image that are games (they have a tile).
   * The Modules page lists built-ins in a section of its own.
   */
  showBuiltins?: boolean;
  /** After every change, and after each load, with the listing. */
  onListing?: (listing: CatalogListing) => void;
  /** Called when something was installed, updated or removed. */
  onChanged?: () => void;
  /** Change it to make the list load again (after a pack upload, say). */
  refreshKey?: number;
}

export function GameCatalog({ showBuiltins = false, onListing, onChanged, refreshKey = 0 }: GameCatalogProps) {
  const { t, i18n } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [listing, setListing] = useState<CatalogListing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: CatalogAction } | null>(null);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [reloadFor, setReloadFor] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<{ item: CatalogItem; action: 'install' | 'uninstall' } | null>(null);
  const [query, setQuery] = useState('');
  const [updatingAll, setUpdatingAll] = useState(false);
  const [updateAllSummary, setUpdateAllSummary] = useState<CatalogUpdateAllResult | null>(null);
  const [openSections, setOpenSections] = useState<Record<'installed' | 'available', boolean>>({
    installed: true,
    available: false,
  });
  const sectionDefaultsApplied = useRef(false);

  // Held in a ref so a parent passing an inline function does not reload the list on every render.
  const onListingRef = useRef(onListing);
  onListingRef.current = onListing;

  const load = useCallback(async () => {
    try {
      const next = await fetchCatalog();
      setListing(next);
      setLoadError(null);
      onListingRef.current?.(next);
    } catch (error) {
      setLoadError(apiErrorMessage(error, t('catalog.loadFailedFallback')));
    }
  }, [t]);

  const refreshTries = useRef(0);
  useEffect(() => {
    refreshTries.current = 0;
    void load();
  }, [load, refreshKey]);

  // The server answers within a couple of seconds and keeps fetching the
  // feed in the background; list again a few times to pick it up.
  useEffect(() => {
    if (!listing?.feed.refreshing || refreshTries.current >= FEED_REFRESH_TRIES) return;
    const timer = window.setTimeout(() => {
      refreshTries.current += 1;
      void load();
    }, FEED_REFRESH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [listing, load]);

  const key = (item: CatalogItem) => `${item.kind}:${item.id}`;

  const builtinGames = useMemo(() => {
    if (!showBuiltins) return new Map<string, string>();
    return new Map(
      listIntegrations()
        .filter((integration) => integration.catalogIcon)
        .map((integration) => [integration.id, integration.catalogIcon as string])
    );
  }, [showBuiltins]);

  // Unfiltered by the search box, so the sections' attention state and the
  // Update-all count do not flicker away while the admin is typing.
  const itemsAll = useMemo(
    () =>
      (listing?.items ?? []).filter((item) => {
        if (item.state === 'builtin') return builtinGames.has(item.id);
        // Hand-placed code that no catalog offers is the operator's, and listed
        // with the other on-disk modules instead.
        return !(item.kind === 'module' && item.installed?.source === 'manual' && !item.available);
      }),
    [listing, builtinGames]
  );

  const items = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    return wanted ? itemsAll.filter((item) => item.name.toLowerCase().includes(wanted)) : itemsAll;
  }, [itemsAll, query]);

  const installed = items.filter(isInstalled);
  const available = items.filter((item) => !isInstalled(item));
  const restartPending = (listing?.items ?? []).filter((item) => item.restartRequired);
  const updatable = itemsAll.filter((item) => item.state === 'update-available');
  const installedNeedsAttention = itemsAll.some(
    (item) =>
      isInstalled(item) &&
      (item.state === 'update-available' || item.state === 'broken' || item.restartRequired || Boolean(failures[key(item)]))
  );
  const availableNeedsAttention = itemsAll.some((item) => !isInstalled(item) && item.state === 'broken');

  // Installed opens by default; Available opens only when something there
  // needs a look. A stored choice from an earlier visit always wins.
  useEffect(() => {
    if (!listing || sectionDefaultsApplied.current) return;
    sectionDefaultsApplied.current = true;
    setOpenSections({
      installed: readSectionOpen('installed') ?? true,
      available: readSectionOpen('available') ?? availableNeedsAttention,
    });
    // Only the first listing decides the defaults; later ones must not
    // fight a toggle the admin already made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing]);

  const toggleSection = (id: 'installed' | 'available', open: boolean) => {
    setOpenSections((prev) => ({ ...prev, [id]: open }));
    writeSectionOpen(id, open);
  };

  const runUpdateAll = async () => {
    setUpdatingAll(true);
    try {
      const result = await runCatalogUpdateAll();
      setUpdateAllSummary(result);
      if (result.updated.length > 0) showSuccess(t('catalog.updateAll.done', { count: result.updated.length }));
      await load();
      onChanged?.();
    } catch (error) {
      showError(apiErrorMessage(error, t('catalog.updateAll.failedFallback')));
    } finally {
      setUpdatingAll(false);
    }
  };

  const nameForEntry = (entry: { kind: CatalogItem['kind']; id: string }) => {
    const found = listing?.items.find((row) => row.kind === entry.kind && row.id === entry.id);
    return found ? displayName(found) : entry.id;
  };

  const displayName = (item: CatalogItem) =>
    item.state === 'builtin'
      ? t(`modulesPage.module.${item.id}.name`, { defaultValue: item.name })
      : item.name;

  const run = async (item: CatalogItem, action: CatalogAction) => {
    setConfirming(null);
    setBusy({ id: key(item), action });
    setFailures((prev) => {
      const next = { ...prev };
      delete next[key(item)];
      return next;
    });
    try {
      const result = await runCatalogAction(item, action);
      const name = displayName(item);
      const done: Record<CatalogAction, string> = {
        install: 'catalog.done.installed',
        update: 'catalog.done.updated',
        enable: 'catalog.done.enabled',
        disable: 'catalog.done.disabled',
        uninstall: 'catalog.done.removed',
      };
      showSuccess(t(done[action], { name }));
      // A code module the server loaded just now reaches this browser on the
      // next page load: its client half is fetched at boot.
      if (item.kind === 'module' && !result.restartRequired && (action === 'install' || action === 'enable')) {
        setReloadFor((prev) => (prev.includes(name) ? prev : [...prev, name]));
      } else if (action === 'disable' || action === 'uninstall') {
        setReloadFor((prev) => prev.filter((other) => other !== name));
      }
      await load();
      onChanged?.();
    } catch (error) {
      const reason = apiErrorMessage(error, t('catalog.failedFallback'));
      setFailures((prev) => ({ ...prev, [key(item)]: reason }));
      showError(t('catalog.failed', { name: displayName(item), reason }));
      await load();
    } finally {
      setBusy(null);
    }
  };

  const request = (item: CatalogItem, action: CatalogAction) => {
    if (action === 'install' && item.kind === 'module') setConfirming({ item, action: 'install' });
    else if (action === 'uninstall') setConfirming({ item, action: 'uninstall' });
    else void run(item, action);
  };

  const actionsFor = (item: CatalogItem): Array<{ action: CatalogAction; primary?: boolean; danger?: boolean }> => {
    const all = baseActionsFor(item);
    // Waiting for a restart: the server refuses new files until then (the
    // running version still serves its own), so do not offer them.
    return item.restartRequired ? all.filter(({ action }) => action !== 'install' && action !== 'update') : all;
  };

  const baseActionsFor = (item: CatalogItem): Array<{ action: CatalogAction; primary?: boolean; danger?: boolean }> => {
    switch (item.state) {
      case 'available':
        return [{ action: 'install', primary: true }];
      case 'update-available':
        return [
          { action: 'update', primary: true },
          ...(item.kind === 'module' ? [{ action: 'disable' as const }] : []),
          { action: 'uninstall', danger: true },
        ];
      case 'installed':
        return [...(item.kind === 'module' ? [{ action: 'disable' as const }] : []), { action: 'uninstall', danger: true }];
      case 'disabled':
        return [{ action: 'enable', primary: true }, { action: 'uninstall', danger: true }];
      case 'broken':
      case 'incompatible':
        return isInstalled(item) ? [{ action: 'uninstall', danger: true }] : [];
      default:
        return [];
    }
  };

  const actionLabel = (item: CatalogItem, action: CatalogAction) => {
    if (action === 'update') return t('catalog.action.update', { version: item.available?.version ?? '' });
    if (action === 'uninstall') return t(item.kind === 'pack' ? 'catalog.action.remove' : 'catalog.action.uninstall');
    return t(`catalog.action.${action}`);
  };

  const row = (item: CatalogItem) => {
    const id = `catalog-${item.kind}-${item.id}`;
    const working = busy?.id === key(item) ? busy.action : null;
    const failure = failures[key(item)];
    const icon = item.state === 'builtin' ? builtinGames.get(item.id) ?? null : item.icon;
    const version = item.installed?.version ?? item.available?.version ?? null;
    const description =
      item.state === 'builtin'
        ? t(`modulesPage.module.${item.id}.hint`, { defaultValue: '' })
        : item.description || (item.engine ? t('modulesPage.packs.runBy', { engine: item.engine }) : '');
    const showReason = item.reason && (item.restartRequired || item.state === 'broken' || item.state === 'incompatible');

    return (
      <Card key={key(item)} variant="outlined" data-testid={id}>
        <CardContent
          sx={{
            display: 'flex',
            gap: 2,
            alignItems: { xs: 'flex-start', sm: 'center' },
            flexDirection: { xs: 'column', sm: 'row' },
            '&:last-child': { pb: 2 },
          }}
        >
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', minWidth: 0, flex: 1, width: '100%' }}>
            <CatalogTile src={icon} name={displayName(item)} />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                <Typography fontWeight={600}>{displayName(item)}</Typography>
                {version && <Chip size="small" label={version} />}
                {item.kind === 'module' && item.state !== 'builtin' && (
                  <Chip size="small" variant="outlined" icon={<CodeIcon />} label={t('catalog.kind.module')} />
                )}
                {working ? (
                  <Chip
                    size="small"
                    color="info"
                    icon={<CircularProgress size={12} color="inherit" />}
                    label={t(working === 'install' || working === 'update' ? 'catalog.state.installing' : 'catalog.state.working')}
                    data-testid={`${id}-state`}
                  />
                ) : item.restartRequired ? (
                  <Chip size="small" color="warning" label={t('catalog.state.restart')} data-testid={`${id}-state`} />
                ) : item.state !== 'available' ? (
                  <Chip
                    size="small"
                    color={STATE_COLOR[item.state]}
                    variant={item.state === 'installed' ? 'filled' : 'outlined'}
                    label={t(`catalog.state.${item.state}`)}
                    data-testid={`${id}-state`}
                  />
                ) : item.available?.from === 'snapshot' && listing?.feed.from === 'remote' ? (
                  // Said only when the feed is up: offline, everything is from the image.
                  <Chip size="small" variant="outlined" label={t('catalog.source.snapshot')} data-testid={`${id}-state`} />
                ) : null}
              </Stack>
              {description && (
                <Typography variant="body2" color="text.secondary">
                  {description}
                </Typography>
              )}
              {item.kind === 'module' && item.installed?.keyId && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block' }}
                  data-testid={`${id}-signed-by`}
                >
                  {t('catalog.signedBy', { label: item.installed.keyLabel ?? '', keyId: item.installed.keyId })}
                </Typography>
              )}
              {showReason && (
                <Typography
                  variant="body2"
                  color={item.state === 'broken' ? 'error' : 'text.secondary'}
                  data-testid={`${id}-reason`}
                >
                  {item.reason}
                </Typography>
              )}
              {item.notice && (
                <Typography variant="body2" color="warning.main" data-testid={`${id}-notice`}>
                  {item.notice}
                </Typography>
              )}
            </Box>
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0, alignSelf: { xs: 'flex-end', sm: 'center' } }}>
            {actionsFor(item).map(({ action, primary, danger }) => (
              <Button
                key={action}
                size="small"
                variant={primary ? 'contained' : 'text'}
                color={danger ? 'error' : 'primary'}
                disabled={busy !== null}
                onClick={() => request(item, action)}
                data-testid={`${id}-${action}`}
              >
                {actionLabel(item, action)}
              </Button>
            ))}
          </Stack>
        </CardContent>
        {failure && (
          <Alert severity="error" sx={{ borderRadius: 0 }} data-testid={`${id}-failure`}>
            {failure}
          </Alert>
        )}
      </Card>
    );
  };

  if (loadError && !listing) {
    return (
      <Alert severity="error" data-testid="catalog-load-failed" action={<Button color="inherit" size="small" onClick={() => void load()}>{t('catalog.retry')}</Button>}>
        {t('catalog.loadFailed', { reason: loadError })}
      </Alert>
    );
  }
  if (!listing) return <LinearProgress data-testid="catalog-loading" />;

  const feed = listing.feed;
  const total = (listing.items ?? []).length;

  return (
    <Stack spacing={2} data-testid="game-catalog">
      {feed.stale && (
        <Alert severity={feed.from === 'cache' ? 'info' : 'warning'} data-testid="catalog-feed-stale">
          {feedMessage(t, feed, i18n.language)}
        </Alert>
      )}
      {restartPending.length > 0 && (
        <Alert severity="warning" data-testid="catalog-restart" action={<RestartNowButton />}>
          {t('catalog.restart', { names: restartPending.map(displayName).join(', ') })}
        </Alert>
      )}
      {updateAllSummary && (
        <Alert
          severity={updateAllSummary.failed.length > 0 ? 'warning' : 'success'}
          onClose={() => setUpdateAllSummary(null)}
          data-testid="catalog-update-all-summary"
        >
          {t('catalog.updateAll.summary', {
            updated: updateAllSummary.updated.length,
            skipped: updateAllSummary.skipped.length,
            failed: updateAllSummary.failed.length,
          })}
          {updateAllSummary.failed.length > 0 && (
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
              {updateAllSummary.failed.map((entry) => (
                <li key={`${entry.kind}:${entry.id}`}>
                  {t('catalog.updateAll.failedItem', { name: nameForEntry(entry), reason: entry.error })}
                </li>
              ))}
            </Box>
          )}
        </Alert>
      )}
      {reloadFor.length > 0 && (
        <Alert
          severity="success"
          data-testid="catalog-reload"
          action={
            <Button color="inherit" size="small" onClick={() => window.location.reload()}>
              {t('catalog.reload.action')}
            </Button>
          }
        >
          {t('catalog.reload.body', { names: reloadFor.join(', ') })}
        </Alert>
      )}

      {total > SEARCH_FROM && (
        <TextField
          size="small"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('catalog.search')}
          inputProps={{ 'aria-label': t('catalog.search'), 'data-testid': 'catalog-search' }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{ maxWidth: 360 }}
        />
      )}

      <Accordion
        expanded={openSections.installed}
        onChange={(_, expanded) => toggleSection('installed', expanded)}
        data-testid="catalog-installed"
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} data-testid="catalog-installed-toggle">
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ flex: 1, pr: 1 }}>
            <Typography variant="subtitle2" color={installedNeedsAttention ? 'warning.main' : 'text.secondary'}>
              {t('catalog.installedTitle', { count: installed.length })}
            </Typography>
            <Box sx={{ flex: 1 }} />
            {updatable.length > 0 && (
              <Button
                size="small"
                variant="outlined"
                disabled={updatingAll || busy !== null}
                onClick={(event) => {
                  event.stopPropagation();
                  void runUpdateAll();
                }}
                data-testid="catalog-update-all"
              >
                {updatingAll ? (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <CircularProgress size={14} color="inherit" />
                    <span>{t('catalog.updateAll.running')}</span>
                  </Stack>
                ) : (
                  t('catalog.updateAll.action', { count: updatable.length })
                )}
              </Button>
            )}
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          {installed.length === 0 ? (
            <Alert severity="info" data-testid="catalog-none-installed">
              {query ? t('catalog.empty') : t('catalog.noneInstalled')}
            </Alert>
          ) : (
            <Stack spacing={1.5}>{installed.map(row)}</Stack>
          )}
        </AccordionDetails>
      </Accordion>

      <Accordion
        expanded={openSections.available}
        onChange={(_, expanded) => toggleSection('available', expanded)}
        data-testid="catalog-available"
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} data-testid="catalog-available-toggle">
          <Typography variant="subtitle2" color={availableNeedsAttention ? 'warning.main' : 'text.secondary'}>
            {t('catalog.availableTitle', { count: available.length })}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          {available.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {query ? t('catalog.empty') : t('catalog.allInstalled')}
            </Typography>
          ) : (
            <Stack spacing={1.5}>{available.map(row)}</Stack>
          )}
        </AccordionDetails>
      </Accordion>

      <Dialog
        open={confirming?.action === 'install'}
        onClose={() => setConfirming(null)}
        maxWidth="sm"
        fullWidth
        data-testid="catalog-confirm-install"
      >
        {confirming?.action === 'install' && (
          <>
            <DialogTitle>{t('catalog.confirmInstall.title', { name: displayName(confirming.item) })}</DialogTitle>
            <DialogContent>
              <DialogContentText sx={{ mb: 2 }}>{t('catalog.confirmInstall.body')}</DialogContentText>
              <Typography variant="body2">
                {t('catalog.confirmInstall.version', { version: confirming.item.available?.version ?? '' })}
              </Typography>
              <Typography variant="body2">
                {t('catalog.confirmInstall.from', {
                  source:
                    confirming.item.available?.from === 'snapshot'
                      ? t('catalog.confirmInstall.fromSnapshot')
                      : t('catalog.confirmInstall.fromRemote'),
                })}
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirming(null)}>{t('common.cancel')}</Button>
              <Button
                variant="contained"
                onClick={() => void run(confirming.item, 'install')}
                data-testid="catalog-confirm-install-go"
              >
                {t('catalog.action.install')}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Dialog
        open={confirming?.action === 'uninstall'}
        onClose={() => setConfirming(null)}
        data-testid="catalog-confirm-uninstall"
      >
        {confirming?.action === 'uninstall' && (
          <>
            <DialogTitle>
              {t(confirming.item.kind === 'pack' ? 'modulesPage.confirmRemove.title' : 'catalog.confirmUninstall.title', {
                name: displayName(confirming.item),
              })}
            </DialogTitle>
            <DialogContent>
              <DialogContentText>
                {t(confirming.item.kind === 'pack' ? 'catalog.confirmUninstall.packBody' : 'catalog.confirmUninstall.body')}
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirming(null)}>{t('common.cancel')}</Button>
              <Button
                color="error"
                onClick={() => void run(confirming.item, 'uninstall')}
                data-testid="modules-confirm-remove"
              >
                {actionLabel(confirming.item, 'uninstall')}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Stack>
  );
}
