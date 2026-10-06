import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { ArrowClockwiseIcon, CopyIcon, PaperPlaneTiltIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { tokens, radii } from '../../theme/tokens';
import { SettingsCardHead, SettingsRow } from './SettingsRow';

interface EventTypeInfo {
  type: string;
  description: string;
}

interface Endpoint {
  id: string;
  url: string;
  description: string;
  eventTypes: string[];
  active: boolean;
  source: string | null;
  /** 'signed' JSON envelope, or a 'discord' webhook (an embed message). */
  format?: 'signed' | 'discord';
  disabledReason: string | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  previousSecretActive: boolean;
  deliveries: Record<string, number>;
}

interface ListResponse {
  allowPrivateTargets: boolean;
  eventTypes: EventTypeInfo[];
  endpoints: Endpoint[];
}

interface Delivery {
  id: string;
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  test: boolean;
  lastStatusCode: number | null;
  lastError: string | null;
  lastResponse: string | null;
  createdAt: number;
  nextAttemptAt: number | null;
  payload: unknown;
}

interface EndpointForm {
  id?: string;
  url: string;
  description: string;
  source: string;
  format: 'signed' | 'discord';
  allTypes: boolean;
  eventTypes: string[];
  active: boolean;
}

const EMPTY_FORM: EndpointForm = {
  url: '',
  description: '',
  source: '',
  format: 'signed',
  allTypes: true,
  eventTypes: [],
  active: true,
};

const STATUS_COLOR: Record<string, 'success' | 'error' | 'warning' | 'default' | 'info'> = {
  succeeded: 'success',
  failed: 'error',
  pending: 'warning',
  delivering: 'info',
  cancelled: 'default',
};

function when(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString() : '—';
}

/**
 * Settings → Webhooks: the integrator webhooks (docs/WEBHOOKS.md). Endpoints
 * with their event types, the signing secret shown once, test events per
 * type, the delivery log (connect details redacted by the API) with resend,
 * and the switch for private / local targets (LAN events).
 */
/** An endpoint's host, to name it in its row when it has no description. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function WebhooksCard() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [data, setData] = useState<ListResponse | null>(null);
  const [form, setForm] = useState<EndpointForm | null>(null);
  const [secret, setSecret] = useState<{ endpointId: string; value: string } | null>(null);
  const [logFor, setLogFor] = useState<Endpoint | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [payload, setPayload] = useState<Delivery | null>(null);
  const [testType, setTestType] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<Endpoint | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(async () => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ListResponse>('/api/webhooks')
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => showError(apiErrorMessage(err, t('webhooksPage.errors.load'))));
    return () => {
      cancelled = true;
    };
  }, [reloadKey, showError, t]);

  const loadDeliveries = useCallback(
    async (endpoint: Endpoint) => {
      try {
        const res = await api.get<{ deliveries: Delivery[] }>(`/api/webhooks/${endpoint.id}/deliveries?limit=50`);
        setDeliveries(res.deliveries);
      } catch (err) {
        showError(apiErrorMessage(err, t('webhooksPage.errors.load')));
      }
    },
    [showError, t]
  );

  if (!data) return null;

  const setAllowPrivate = async (value: boolean) => {
    try {
      await api.put('/api/settings', { webhooksAllowPrivateTargets: value });
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('webhooksPage.errors.save')));
    }
  };

  const save = async () => {
    if (!form) return;
    const body = {
      url: form.url.trim(),
      description: form.description,
      source: form.source.trim() || null,
      format: form.format,
      eventTypes: form.allTypes ? ['*'] : form.eventTypes,
      active: form.active,
    };
    try {
      if (form.id) {
        await api.patch(`/api/webhooks/${form.id}`, body);
        showSuccess(t('webhooksPage.saved'));
      } else {
        const res = await api.post<{ endpoint: Endpoint; secret: string }>('/api/webhooks', body);
        // A Discord endpoint is not signed: its secret is of no use to anyone.
        if (form.format === 'discord') showSuccess(t('webhooksPage.saved'));
        else setSecret({ endpointId: res.endpoint.id, value: res.secret });
      }
      setForm(null);
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('webhooksPage.errors.save')));
    }
  };

  const toggleActive = async (endpoint: Endpoint) => {
    try {
      await api.patch(`/api/webhooks/${endpoint.id}`, { active: !endpoint.active });
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('webhooksPage.errors.save')));
    }
  };

  const rotate = async (endpoint: Endpoint) => {
    try {
      const res = await api.post<{ secret: string }>(`/api/webhooks/${endpoint.id}/rotate-secret`, {});
      setSecret({ endpointId: endpoint.id, value: res.secret });
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('webhooksPage.errors.save')));
    }
  };

  const remove = async (endpoint: Endpoint) => {
    try {
      await api.delete(`/api/webhooks/${endpoint.id}`);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      showError(apiErrorMessage(err, t('webhooksPage.errors.save')));
    }
  };

  const sendTest = async (endpoint: Endpoint) => {
    const type = testType[endpoint.id] ?? 'match.ready';
    try {
      await api.post(`/api/webhooks/${endpoint.id}/test`, { type });
      showSuccess(t('webhooksPage.testQueued', { type }));
      setTimeout(() => void load(), 1500);
    } catch (err) {
      showError(apiErrorMessage(err, t('webhooksPage.errors.test')));
    }
  };

  const resend = async (delivery: Delivery) => {
    try {
      await api.post(`/api/webhooks/deliveries/${delivery.id}/resend`, {});
      showSuccess(t('webhooksPage.resendQueued'));
      if (logFor) setTimeout(() => void loadDeliveries(logFor), 1500);
    } catch (err) {
      showError(apiErrorMessage(err, t('webhooksPage.errors.resend')));
    }
  };

  return (
    <Stack spacing={0} data-testid="settings-webhooks-card">
      <SettingsCardHead
        title={t('webhooksPage.title')}
        hint={t('webhooksPage.short')}
        action={
          <Button
            size="small"
            startIcon={<PlusIcon size={14} />}
            onClick={() => setForm({ ...EMPTY_FORM })}
            data-testid="webhook-add"
            sx={{ borderRadius: radii.pill, bgcolor: tokens.color.paper3, color: tokens.color.ink, px: 1.75, flex: 'none' }}
          >
            {t('webhooksPage.addShort')}
          </Button>
        }
      />

      {data.endpoints
        .filter((e) => e.disabledReason)
        .map((e) => (
          <Alert severity="error" key={`disabled-${e.id}`} data-testid="webhook-disabled-notice" sx={{ mb: 1.5 }}>
            <strong>{e.url}</strong>: {e.disabledReason}
          </Alert>
        ))}

      {data.endpoints.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ pb: 1.5 }}>
          {t('webhooksPage.empty')}
        </Typography>
      )}

      {data.endpoints.map((endpoint) => {
        const failed = endpoint.deliveries.failed ?? 0;
        const health = !endpoint.active
          ? { label: t('webhooksPage.inactive'), color: 'default' as const }
          : failed > 0
            ? { label: t('webhooksPage.failedCount', { count: failed }), color: 'error' as const }
            : { label: t('webhooksPage.working'), color: 'success' as const };
        return (
          <SettingsRow
            key={endpoint.id}
            data-testid={`webhook-endpoint-${endpoint.id}`}
            title={
              <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {endpoint.description || hostOf(endpoint.url)}
                </Box>
                {endpoint.format === 'discord' && (
                  <Chip size="small" variant="outlined" label="Discord" data-testid={`webhook-discord-${endpoint.id}`} />
                )}
              </Box>
            }
            sub={endpoint.eventTypes.includes('*') ? t('webhooksPage.allEvents') : endpoint.eventTypes.join(', ')}
            openLabel={t('webhooksPage.edit')}
            control={
              <>
                <Chip size="small" color={health.color} label={health.label} />
                <Switch
                  checked={endpoint.active}
                  onChange={() => void toggleActive(endpoint)}
                  inputProps={{ 'aria-label': endpoint.active ? t('webhooksPage.disable') : t('webhooksPage.enable') }}
                />
              </>
            }
          >
            <Stack spacing={1.25}>
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                {endpoint.url}
                {endpoint.source ? ` · source: ${endpoint.source}` : ''}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('webhooksPage.counts', {
                  succeeded: endpoint.deliveries.succeeded ?? 0,
                  pending: (endpoint.deliveries.pending ?? 0) + (endpoint.deliveries.delivering ?? 0),
                  failed,
                })}
                {' · '}
                {t('webhooksPage.lastSuccess', { when: when(endpoint.lastSuccessAt) })}
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                <Button
                  size="small"
                  onClick={() =>
                    setForm({
                      id: endpoint.id,
                      url: endpoint.url,
                      description: endpoint.description,
                      source: endpoint.source ?? '',
                      format: endpoint.format ?? 'signed',
                      allTypes: endpoint.eventTypes.includes('*'),
                      eventTypes: endpoint.eventTypes.filter((x) => x !== '*'),
                      active: endpoint.active,
                    })
                  }
                >
                  {t('webhooksPage.edit')}
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    setLogFor(endpoint);
                    void loadDeliveries(endpoint);
                  }}
                >
                  {t('webhooksPage.deliveries')}
                </Button>
                <Button size="small" onClick={() => void rotate(endpoint)}>
                  {t('webhooksPage.rotate')}
                </Button>
                <IconButton size="small" color="error" onClick={() => setConfirmDelete(endpoint)} aria-label={t('webhooksPage.delete')}>
                  <TrashIcon />
                </IconButton>
              </Stack>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                <Select
                  size="small"
                  value={testType[endpoint.id] ?? 'match.ready'}
                  onChange={(e) => setTestType((prev) => ({ ...prev, [endpoint.id]: e.target.value }))}
                  sx={{ minWidth: 200 }}
                  inputProps={{ 'aria-label': t('webhooksPage.testType') }}
                >
                  {data.eventTypes.map((et) => (
                    <MenuItem key={et.type} value={et.type}>
                      {et.type}
                    </MenuItem>
                  ))}
                </Select>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<PaperPlaneTiltIcon />}
                  disabled={!endpoint.active}
                  onClick={() => void sendTest(endpoint)}
                  data-testid={`webhook-test-${endpoint.id}`}
                >
                  {t('webhooksPage.sendTest')}
                </Button>
              </Stack>
            </Stack>
          </SettingsRow>
        );
      })}

      <SettingsRow
        title={t('webhooksPage.allowPrivate')}
        sub={t('webhooksPage.allowPrivateShort')}
        control={
          <Switch
            checked={data.allowPrivateTargets}
            onChange={(event) => void setAllowPrivate(event.target.checked)}
            inputProps={{ 'aria-label': t('webhooksPage.allowPrivate') }}
            data-testid="webhooks-allow-private"
          />
        }
      />

      {/* Create / edit */}
      <Dialog open={form !== null} onClose={() => setForm(null)} fullWidth maxWidth="sm">
        <DialogTitle>{form?.id ? t('webhooksPage.editTitle') : t('webhooksPage.addTitle')}</DialogTitle>
        {form && (
          <DialogContent>
            <Stack spacing={2} mt={1}>
              <TextField
                select
                label={t('webhooksPage.format')}
                value={form.format}
                onChange={(e) => {
                  const format = e.target.value as EndpointForm['format'];
                  // A new Discord endpoint starts on the admin calls, what a #admins channel is for.
                  setForm(
                    format === 'discord' && !form.id && form.allTypes
                      ? { ...form, format, allTypes: false, eventTypes: ['admin.called', 'admin.call_resolved'] }
                      : { ...form, format }
                  );
                }}
                helperText={form.format === 'discord' ? t('webhooksPage.formatDiscordHelp') : t('webhooksPage.formatSignedHelp')}
                SelectProps={{ native: true }}
                inputProps={{ 'data-testid': 'webhook-format' }}
                fullWidth
              >
                <option value="signed">{t('webhooksPage.formatSigned')}</option>
                <option value="discord">{t('webhooksPage.formatDiscord')}</option>
              </TextField>
              <TextField
                label={t('webhooksPage.url')}
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder={form.format === 'discord' ? 'https://discord.com/api/webhooks/…' : 'https://example.com/hooks/auto-tournament'}
                fullWidth
                required
              />
              <TextField
                label={t('webhooksPage.descriptionLabel')}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                fullWidth
              />
              <TextField
                label={t('webhooksPage.source')}
                helperText={t('webhooksPage.sourceHelp')}
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                fullWidth
              />
              <FormControlLabel
                control={<Checkbox checked={form.allTypes} onChange={(e) => setForm({ ...form, allTypes: e.target.checked })} />}
                label={t('webhooksPage.allEvents')}
              />
              {!form.allTypes && (
                <FormGroup>
                  {data.eventTypes.map((et) => (
                    <Tooltip key={et.type} title={et.description} placement="right">
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={form.eventTypes.includes(et.type)}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                eventTypes: e.target.checked
                                  ? [...form.eventTypes, et.type]
                                  : form.eventTypes.filter((x) => x !== et.type),
                              })
                            }
                          />
                        }
                        label={et.type}
                      />
                    </Tooltip>
                  ))}
                </FormGroup>
              )}
              <FormControlLabel
                control={<Switch checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />}
                label={t('webhooksPage.active')}
              />
            </Stack>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setForm(null)}>{t('webhooksPage.cancel')}</Button>
          <Button variant="contained" onClick={() => void save()} disabled={!form?.url.trim()}>
            {t('webhooksPage.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* The secret, once */}
      <Dialog open={secret !== null} onClose={() => setSecret(null)} fullWidth maxWidth="sm">
        <DialogTitle>{t('webhooksPage.secretTitle')}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('webhooksPage.secretOnce')}
          </Alert>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField value={secret?.value ?? ''} fullWidth InputProps={{ readOnly: true }} data-testid="webhook-secret" />
            <IconButton
              aria-label={t('webhooksPage.copy')}
              onClick={() => {
                if (secret) void navigator.clipboard?.writeText(secret.value);
              }}
            >
              <CopyIcon />
            </IconButton>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setSecret(null)}>
            {t('webhooksPage.done')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delivery log */}
      <Dialog open={logFor !== null} onClose={() => setLogFor(null)} fullWidth maxWidth="lg">
        <DialogTitle>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <span>{t('webhooksPage.deliveriesTitle', { url: logFor?.url ?? '' })}</span>
            <IconButton onClick={() => logFor && void loadDeliveries(logFor)} aria-label={t('webhooksPage.refresh')}>
              <ArrowClockwiseIcon />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent>
          {deliveries.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('webhooksPage.noDeliveries')}
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('webhooksPage.col.time')}</TableCell>
                  <TableCell>{t('webhooksPage.col.event')}</TableCell>
                  <TableCell>{t('webhooksPage.col.status')}</TableCell>
                  <TableCell>{t('webhooksPage.col.code')}</TableCell>
                  <TableCell>{t('webhooksPage.col.attempts')}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {deliveries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{when(d.createdAt)}</TableCell>
                    <TableCell>
                      {d.eventType}
                      {d.test && <Chip size="small" label="test" sx={{ ml: 1 }} />}
                    </TableCell>
                    <TableCell>
                      <Tooltip title={d.lastError ?? ''}>
                        <Chip size="small" color={STATUS_COLOR[d.status] ?? 'default'} label={d.status} />
                      </Tooltip>
                    </TableCell>
                    <TableCell>{d.lastStatusCode ?? '—'}</TableCell>
                    <TableCell>{d.attempts}</TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => setPayload(d)}>
                        {t('webhooksPage.view')}
                      </Button>
                      <Button size="small" onClick={() => void resend(d)} data-testid={`webhook-resend-${d.id}`}>
                        {t('webhooksPage.resend')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLogFor(null)}>{t('webhooksPage.done')}</Button>
        </DialogActions>
      </Dialog>

      {/* One payload (redacted by the API) */}
      <Dialog open={payload !== null} onClose={() => setPayload(null)} fullWidth maxWidth="md">
        <DialogTitle>{payload?.eventType}</DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary" display="block" mb={1}>
            {t('webhooksPage.redactedNote')}
          </Typography>
          <Box component="pre" sx={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', m: 0 }}>
            {JSON.stringify(payload?.payload, null, 2)}
          </Box>
          {payload?.lastResponse && (
            <>
              <Typography variant="subtitle2" mt={2}>
                {t('webhooksPage.response')}
              </Typography>
              <Box component="pre" sx={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', m: 0 }}>
                {payload.lastResponse}
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPayload(null)}>{t('webhooksPage.done')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>{t('webhooksPage.deleteTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">{t('webhooksPage.deleteBody', { url: confirmDelete?.url ?? '' })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>{t('webhooksPage.cancel')}</Button>
          <Button color="error" variant="contained" onClick={() => confirmDelete && void remove(confirmDelete)}>
            {t('webhooksPage.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

export default WebhooksCard;
