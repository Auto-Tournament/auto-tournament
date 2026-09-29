/**
 * The Servers page's "Failover" area (FLEET.md §11): whether the platform
 * moves a match off a Ready Up server that went down on its own (on by
 * default), and the reserve: idle Ready Up servers normal allocation leaves
 * for failover. Shows which servers are held right now.
 */

import { useCallback, useEffect, useState } from 'react';
import { Box, Chip, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import { api, apiErrorMessage, Panel, SectionHead, useModuleTranslation, useSnackbar } from '../../../module-sdk';

interface FailoverSettingsResponse {
  settings: { auto: boolean; reserve: number | null };
  reserve: {
    configured: number | null;
    effective: number;
    poolSize: number;
    held: Array<{ id: string; name: string }>;
  };
}

const POLL_MS = 15_000;
const AUTO = 'auto';
const RESERVE_CHOICES = [0, 1, 2, 3, 4];

export default function FailoverSettingsPanel() {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const [data, setData] = useState<FailoverSettingsResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get<FailoverSettingsResponse>('/api/fleet/failover/settings'));
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const save = async (patch: { auto?: boolean; reserve?: number | null }) => {
    setBusy(true);
    try {
      setData(await api.put<FailoverSettingsResponse>('/api/fleet/failover/settings', patch));
    } catch (err) {
      showError(apiErrorMessage(err, t('failoverSettings.saveFailed', { defaultValue: 'Could not save the failover settings' })));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  // Nothing to fail over to or from yet.
  if (data.reserve.poolSize === 0 && data.settings.auto && data.settings.reserve === null) return null;

  const reserveValue = data.settings.reserve === null ? AUTO : String(data.settings.reserve);

  return (
    <Box data-testid="failover-settings-panel" mt={4}>
      <SectionHead title={t('failoverSettings.title', { defaultValue: 'Failover' })} />
      <Panel sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={data.settings.auto}
                  onChange={(e) => void save({ auto: e.target.checked })}
                  disabled={busy}
                  data-testid="failover-auto-switch"
                />
              }
              label={t('failoverSettings.auto', { defaultValue: 'Automatic failover' })}
            />
            <Typography variant="body2" color="text.secondary">
              {t('failoverSettings.autoHelp', {
                defaultValue:
                  'When a Ready Up server goes down during a match, the match resumes from the last round backup: on the same server if it comes back in time, else on a free one. Off: the match page asks an admin first.',
              })}
            </Typography>
          </Box>

          <Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
              <TextField
                select
                size="small"
                label={t('failoverSettings.reserve', { defaultValue: 'Spare servers' })}
                value={reserveValue}
                onChange={(e) => void save({ reserve: e.target.value === AUTO ? null : Number(e.target.value) })}
                disabled={busy}
                sx={{ minWidth: 220 }}
                data-testid="failover-reserve-select"
              >
                <MenuItem value={AUTO}>
                  {t('failoverSettings.reserveAuto', { defaultValue: 'Automatic (1 once 2 servers are online)' })}
                </MenuItem>
                {RESERVE_CHOICES.map((n) => (
                  <MenuItem key={n} value={String(n)}>
                    {n}
                  </MenuItem>
                ))}
              </TextField>
              <Typography variant="body2" data-testid="failover-reserve-status">
                {t('failoverSettings.reserveStatus', {
                  defaultValue: '{{effective}} of {{pool}} online server(s) kept free for failover',
                  effective: data.reserve.effective,
                  pool: data.reserve.poolSize,
                })}
              </Typography>
              {data.reserve.held.map((s) => (
                <Chip key={s.id} size="small" variant="outlined" label={s.name} />
              ))}
            </Stack>
            <Typography variant="body2" color="text.secondary" mt={1}>
              {t('failoverSettings.reserveHelp', {
                defaultValue:
                  'Spare servers stay idle: matches are not put on them, so one is ready when a server goes down. At least one server always takes matches. Spare servers count toward your license like any other server.',
              })}
            </Typography>
          </Box>
        </Stack>
      </Panel>
    </Box>
  );
}
