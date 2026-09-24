/**
 * The Modules page's code modules: the ones an operator put on this server's
 * disk (DESIGN-module-client-api.md, decision 2), listed next to the
 * built-ins with what the server and this browser found out about each.
 *
 * Code modules are never uploaded. Installing code takes the same access as
 * editing `.env`, so a stolen admin session cannot become code execution on
 * the host; this list can only enable and disable what is already there.
 * Enabling one asks first, in a dialog that cannot be dismissed by accident,
 * because a code module runs as the platform (§5).
 *
 * Renders nothing on an instance without code modules, or on an API that
 * does not answer `GET /api/modules` yet.
 */

import { useCallback, useEffect, useState } from 'react';
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
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CodeIcon from '@mui/icons-material/Code';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { api } from '../../utils/api';
import { fetchModuleList, MODULES_ENDPOINT } from '../../module-loader/boot';
import type { ModuleFailure, ModuleListEntry, ModuleServerStatus } from '../../module-loader/manifest';
import { useModuleState } from '../../module-loader/useModuleState';
import type { ModuleState } from '../../module-loader/moduleState';

const STATUS_COLOR: Record<ModuleServerStatus, 'success' | 'warning' | 'error' | 'default'> = {
  ok: 'success',
  incompatible: 'warning',
  broken: 'error',
  disabled: 'default',
};

/** Refusals that mean "built for another client API", not "broken". */
const INCOMPATIBLE = new Set<ModuleFailure['code']>(['outOfRange', 'noClientApi', 'badClientApi']);

/** A loader failure, as a sentence in the admin's language. */
export function describeModuleFailure(failure: ModuleFailure, t: TFunction): string {
  return t(`modulesPage.code.failure.${failure.code}`, {
    ...failure.params,
    defaultValue: failure.message,
  });
}

/**
 * What the page shows for a module: the server's status, unless this browser
 * found it broken (a link error or a render crash is something only a browser
 * can see).
 */
function effectiveStatus(
  entry: ModuleListEntry,
  state: ModuleState,
  t: TFunction
): { status: ModuleServerStatus; reason: string | null } {
  const found = state.failures[entry.id];
  if (entry.enabled && entry.status === 'ok' && found && INCOMPATIBLE.has(found.code)) {
    // Refused on its declared client API range: nothing is wrong with the
    // module, it was built for another platform.
    return { status: 'incompatible', reason: describeModuleFailure(found, t) };
  }
  if (entry.enabled && entry.status === 'ok' && found) {
    return {
      status: 'broken',
      reason: t('modulesPage.code.broken', { reason: describeModuleFailure(found, t) }),
    };
  }
  if (entry.status === 'broken') {
    return {
      status: 'broken',
      reason: t('modulesPage.code.broken', {
        reason: entry.reason || t('modulesPage.code.noReason'),
      }),
    };
  }
  return { status: entry.status, reason: entry.reason };
}

function reasonOf(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  try {
    const body = JSON.parse(error.message) as { error?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) return body.error;
  } catch {
    // Not JSON.
  }
  return error.message || fallback;
}

function EnableDialog({
  entry,
  busy,
  onCancel,
  onConfirm,
}: {
  entry: ModuleListEntry;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (entry: ModuleListEntry) => void;
}) {
  const { t } = useTranslation();
  // Mounted per module (keyed by id), so the typed id never carries over.
  const [typed, setTyped] = useState('');

  const none = t('modulesPage.code.confirm.none');
  const details: Array<[string, string]> = [
    [t('modulesPage.code.confirm.source'), t('modulesPage.code.confirm.onDisk')],
    [t('modulesPage.code.confirm.version'), entry.version || none],
    [t('modulesPage.code.confirm.clientApi'), entry.clientApi || none],
    [t('modulesPage.code.confirm.serverApi'), entry.serverApi || none],
  ];

  return (
    <Dialog
      open
      // Not dismissible by accident: no backdrop click, no Escape. Cancel is a button.
      onClose={() => undefined}
      disableEscapeKeyDown
      maxWidth="sm"
      fullWidth
      data-testid="code-module-enable-dialog"
    >
      <DialogTitle>{t('modulesPage.code.confirm.title', { name: entry.name })}</DialogTitle>
      <DialogContent dividers>
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography fontWeight={700} gutterBottom>
            {t('modulesPage.code.confirm.warningTitle')}
          </Typography>
          {t('modulesPage.code.confirm.warning')}
        </Alert>
        <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 0.5, mb: 2, mt: 0 }}>
          {details.map(([label, value]) => (
            <Box key={label} sx={{ display: 'contents' }}>
              <Typography component="dt" variant="body2" color="text.secondary" sx={{ pr: 2 }}>
                {label}
              </Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0, fontFamily: 'monospace' }}>
                {value}
              </Typography>
            </Box>
          ))}
        </Box>
        <DialogContentText sx={{ mb: 1 }}>
          {t('modulesPage.code.confirm.typeId', { id: entry.id })}
        </DialogContentText>
        <TextField
          fullWidth
          size="small"
          autoComplete="off"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          inputProps={{ 'data-testid': 'code-module-enable-confirm-id', spellCheck: false }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button
          color="warning"
          variant="contained"
          disabled={busy || typed.trim() !== entry.id}
          onClick={() => onConfirm(entry)}
          data-testid="code-module-enable-confirm"
        >
          {t('modulesPage.code.enable')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function CodeModuleList() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const state = useModuleState();
  const [modules, setModules] = useState<ModuleListEntry[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enabling, setEnabling] = useState<ModuleListEntry | null>(null);
  const [needsReload, setNeedsReload] = useState(false);

  const refresh = useCallback(async () => {
    const result = await fetchModuleList();
    if (result.ok) {
      setModules(result.listing.modules.filter((entry) => entry.source === 'disk'));
      setListError(null);
    } else if (result.status === 404) {
      // An API from before code modules: there are none to list.
      setModules([]);
    } else {
      setListError(result.error);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = async (entry: ModuleListEntry, enable: boolean) => {
    setBusy(true);
    try {
      await api.post(
        `${MODULES_ENDPOINT}/${encodeURIComponent(entry.id)}/${enable ? 'enable' : 'disable'}`
      );
      showSuccess(
        t(enable ? 'modulesPage.code.enabled' : 'modulesPage.code.disabled', { name: entry.name })
      );
      // The loader runs once, at boot: the change applies on the next load.
      setNeedsReload(true);
      await refresh();
    } catch (error) {
      showError(reasonOf(error, t('modulesPage.code.toggleFailed')));
    } finally {
      setBusy(false);
      setEnabling(null);
    }
  };

  return (
    <>
      {state.safeMode && (
        <Alert severity="info" data-testid="code-modules-safe-mode">
          {t('modulesPage.code.safeMode')}
        </Alert>
      )}
      {listError && (
        <Alert severity="warning" data-testid="code-modules-list-failed">
          {t('modulesPage.code.listFailed', { reason: listError })}
        </Alert>
      )}
      {needsReload && (
        <Alert
          severity="info"
          data-testid="code-modules-reload"
          action={
            <Button color="inherit" size="small" onClick={() => window.location.reload()}>
              {t('modulesPage.code.reload.action')}
            </Button>
          }
        >
          {t('modulesPage.code.reload.body')}
        </Alert>
      )}

      {modules.map((entry) => {
        const { status, reason } = effectiveStatus(entry, state, t);
        return (
          <Card key={entry.id} variant="outlined" data-testid={`code-module-${entry.id}`}>
            <CardContent
              sx={{ display: 'flex', gap: 2, alignItems: 'center', '&:last-child': { pb: 2 } }}
            >
              <Box
                aria-hidden="true"
                sx={{
                  width: 56,
                  height: 56,
                  flex: '0 0 auto',
                  borderRadius: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: 'action.hover',
                }}
              >
                <CodeIcon />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography fontWeight={600}>{entry.name || entry.id}</Typography>
                  {entry.version && <Chip size="small" label={entry.version} />}
                  <Chip
                    size="small"
                    color={STATUS_COLOR[status] ?? 'default'}
                    label={t(`modulesPage.code.status.${status}`, { defaultValue: status })}
                    data-testid={`code-module-${entry.id}-status`}
                    data-status={status}
                  />
                </Stack>
                <Typography
                  variant="body2"
                  color={status === 'broken' || status === 'incompatible' ? 'error' : 'text.secondary'}
                  data-testid={`code-module-${entry.id}-reason`}
                  sx={{ overflowWrap: 'anywhere' }}
                >
                  {reason || t('modulesPage.code.hint')}
                </Typography>
              </Box>
              <Chip size="small" icon={<CodeIcon />} label={t('modulesPage.code.chip')} />
              {entry.enabled ? (
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy}
                  onClick={() => void toggle(entry, false)}
                  data-testid={`code-module-${entry.id}-disable`}
                >
                  {t('modulesPage.code.disable')}
                </Button>
              ) : (
                <Button
                  size="small"
                  variant="contained"
                  disabled={busy}
                  onClick={() => setEnabling(entry)}
                  data-testid={`code-module-${entry.id}-enable`}
                >
                  {t('modulesPage.code.enable')}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}

      {enabling && (
        <EnableDialog
          key={enabling.id}
          entry={enabling}
          busy={busy}
          onCancel={() => setEnabling(null)}
          onConfirm={(entry) => void toggle(entry, true)}
        />
      )}
    </>
  );
}
