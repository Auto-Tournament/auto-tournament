import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';

interface SearchWindow {
  start: number;
  step: number;
  cap: number;
  /** null = never: the window never opens to any rating. */
  uncappedAfterMinutes: number | null;
}

interface ExperimentalFeatureState {
  id: string;
  enabled: boolean;
  source: 'env' | 'setting' | 'default';
  env: string;
}

/**
 * Settings → Experimental: turn work-in-progress features on or off
 * (`/api/experimental`). Each toggle saves on its own. A feature forced by
 * its environment variable shows the toggle disabled, with the variable's
 * name.
 */
export function ExperimentalCard() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [features, setFeatures] = useState<ExperimentalFeatureState[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  // Matchmaking only: admins only until opened to players (null = not loaded).
  const [mmOpen, setMmOpen] = useState<boolean | null>(null);
  const [mmBoard, setMmBoard] = useState(false);
  // The search window as typed (strings, so a field can be emptied while typing).
  const [win, setWin] = useState<Record<keyof SearchWindow, string> | null>(null);
  const [reserved, setReserved] = useState('0');
  const mmEnabled = features?.find((f) => f.id === 'matchmaking')?.enabled ?? false;

  useEffect(() => {
    if (!mmEnabled) return;
    api
      .get<{ openToPlayers?: boolean; leaderboardPublic?: boolean; searchWindow?: SearchWindow; reservedServers?: number }>(
        '/api/matchmaking/status'
      )
      .then((res) => {
        setMmOpen(res.openToPlayers === true);
        setMmBoard(res.leaderboardPublic === true);
        if (res.searchWindow) setWin(windowStrings(res.searchWindow));
        setReserved(String(res.reservedServers ?? 0));
      })
      .catch(() => setMmOpen(null));
  }, [mmEnabled]);

  const saveMm = async (patch: {
    openToPlayers?: boolean;
    leaderboardPublic?: boolean;
    searchWindow?: SearchWindow;
    reservedServers?: number;
  }) => {
    setSaving('matchmaking-open');
    try {
      const res = await api.put<{
        openToPlayers: boolean;
        leaderboardPublic: boolean;
        searchWindow: SearchWindow;
        reservedServers: number;
      }>(
        '/api/matchmaking/admin/settings',
        patch
      );
      setMmOpen(res.openToPlayers);
      setMmBoard(res.leaderboardPublic);
      setWin(windowStrings(res.searchWindow));
      setReserved(String(res.reservedServers));
      showSuccess(t('settingsPage.experimental.saved'));
    } catch (err) {
      showError(apiErrorMessage(err, t('settingsPage.experimental.saveFailed')));
    } finally {
      setSaving(null);
    }
  };

  useEffect(() => {
    api
      .get<{ features: ExperimentalFeatureState[] }>('/api/experimental')
      .then((res) => setFeatures(res.features))
      .catch((err) => {
        setFeatures([]);
        showError(apiErrorMessage(err, t('settingsPage.experimental.loadFailed')));
      });
  }, [showError, t]);

  const toggle = async (id: string, enabled: boolean) => {
    setSaving(id);
    try {
      const res = await api.put<{ feature: ExperimentalFeatureState }>(
        `/api/experimental/${encodeURIComponent(id)}`,
        { enabled }
      );
      setFeatures((prev) => prev?.map((f) => (f.id === id ? res.feature : f)) ?? null);
      showSuccess(t('settingsPage.experimental.saved'));
    } catch (err) {
      showError(apiErrorMessage(err, t('settingsPage.experimental.saveFailed')));
    } finally {
      setSaving(null);
    }
  };

  if (features === null) return null;

  return (
    <Box data-testid="settings-experimental-card">
      <Typography variant="h6" fontWeight={600} gutterBottom>
        {t('settingsPage.experimental.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={2}>
        {t('settingsPage.experimental.description')}
      </Typography>
      <Stack spacing={2}>
        {features.map((feature) => (
          <Box key={feature.id}>
            <FormControlLabel
              control={
                <Switch
                  checked={feature.enabled}
                  disabled={feature.source === 'env' || saving === feature.id}
                  onChange={(event) => void toggle(feature.id, event.target.checked)}
                  color="primary"
                  size="small"
                  slotProps={{
                    input: {
                      'data-testid': `settings-experimental-${feature.id}`,
                    } as React.InputHTMLAttributes<HTMLInputElement>,
                  }}
                />
              }
              label={t(`settingsPage.experimental.features.${feature.id}.label`)}
            />
            <Typography variant="caption" color="text.secondary" display="block">
              {t(`settingsPage.experimental.features.${feature.id}.description`)}
            </Typography>
            {feature.id === 'matchmaking' && feature.enabled && mmOpen !== null && (
              <Box sx={{ pl: 4, mt: 1 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={mmOpen}
                      disabled={saving === 'matchmaking-open'}
                      onChange={(event) => void saveMm({ openToPlayers: event.target.checked })}
                      size="small"
                      slotProps={{
                        input: {
                          'data-testid': 'settings-matchmaking-open',
                        } as React.InputHTMLAttributes<HTMLInputElement>,
                      }}
                    />
                  }
                  label={t('settingsPage.experimental.features.matchmaking.openLabel')}
                />
                <Typography variant="caption" color="text.secondary" display="block">
                  {t('settingsPage.experimental.features.matchmaking.openDescription')}
                </Typography>
                <FormControlLabel
                  sx={{ mt: 1 }}
                  control={
                    <Switch
                      checked={mmBoard}
                      disabled={saving === 'matchmaking-open'}
                      onChange={(event) => void saveMm({ leaderboardPublic: event.target.checked })}
                      size="small"
                      slotProps={{
                        input: {
                          'data-testid': 'settings-matchmaking-board',
                        } as React.InputHTMLAttributes<HTMLInputElement>,
                      }}
                    />
                  }
                  label={t('settingsPage.experimental.features.matchmaking.boardLabel')}
                />
                <Typography variant="caption" color="text.secondary" display="block">
                  {t('settingsPage.experimental.features.matchmaking.boardDescription')}
                </Typography>
                {win && (
                  <Box mt={2}>
                    <Typography variant="subtitle2">{t('settingsPage.experimental.features.matchmaking.windowTitle')}</Typography>
                    <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                      {t('settingsPage.experimental.features.matchmaking.windowDescription')}
                    </Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                      {(['start', 'step', 'cap', 'uncappedAfterMinutes'] as const).map((key) => (
                        <TextField
                          key={key}
                          size="small"
                          type="number"
                          label={t(`settingsPage.experimental.features.matchmaking.window.${key}`)}
                          value={win[key]}
                          onChange={(e) => setWin({ ...win, [key]: e.target.value })}
                          inputProps={{ min: key === 'uncappedAfterMinutes' ? 1 : 0, 'data-testid': `settings-mm-window-${key}` }}
                          sx={{ maxWidth: 160 }}
                        />
                      ))}
                      <Button
                        disabled={saving === 'matchmaking-open'}
                        onClick={() => void saveMm({ searchWindow: windowFromStrings(win) })}
                        data-testid="settings-mm-window-save"
                      >
                        {t('settingsPage.experimental.features.matchmaking.windowSave')}
                      </Button>
                    </Stack>
                    <Typography variant="subtitle2" mt={2}>
                      {t('settingsPage.experimental.features.matchmaking.reservedTitle')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                      {t('settingsPage.experimental.features.matchmaking.reservedDescription')}
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <TextField
                        size="small"
                        type="number"
                        label={t('settingsPage.experimental.features.matchmaking.reservedLabel')}
                        value={reserved}
                        onChange={(e) => setReserved(e.target.value)}
                        inputProps={{ min: 0, max: 50, 'data-testid': 'settings-mm-reserved' }}
                        sx={{ maxWidth: 160 }}
                      />
                      <Button
                        disabled={saving === 'matchmaking-open'}
                        onClick={() => void saveMm({ reservedServers: Number(reserved) })}
                        data-testid="settings-mm-reserved-save"
                      >
                        {t('settingsPage.experimental.features.matchmaking.windowSave')}
                      </Button>
                    </Stack>
                  </Box>
                )}
              </Box>
            )}
            {feature.source === 'env' && (
              <Typography variant="caption" color="warning.main" display="block">
                {t('settingsPage.experimental.envOverride', { env: feature.env })}
              </Typography>
            )}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

const windowStrings = (w: SearchWindow): Record<keyof SearchWindow, string> => ({
  start: String(w.start),
  step: String(w.step),
  cap: String(w.cap),
  uncappedAfterMinutes: w.uncappedAfterMinutes === null ? '' : String(w.uncappedAfterMinutes),
});

/** An empty "any rating after" field means never. The API validates the rest. */
const windowFromStrings = (w: Record<keyof SearchWindow, string>): SearchWindow => ({
  start: Number(w.start),
  step: Number(w.step),
  cap: Number(w.cap),
  uncappedAfterMinutes: w.uncappedAfterMinutes.trim() === '' ? null : Number(w.uncappedAfterMinutes),
});
