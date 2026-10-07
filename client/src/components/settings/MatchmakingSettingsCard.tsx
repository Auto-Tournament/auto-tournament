import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../../utils/api';
import { SettingsCardHead, SettingsRow } from './SettingsRow';
import { useSnackbar } from '../../contexts/SnackbarContext';

interface SearchWindow {
  start: number;
  step: number;
  cap: number;
  /** null = never: the window never opens to any rating. */
  uncappedAfterMinutes: number | null;
}

interface Pool {
  id: number;
  name: string;
  maps: number;
}

interface MatchmakingStatus {
  openToPlayers?: boolean;
  leaderboardPublic?: boolean;
  searchWindow?: SearchWindow;
  reservedServers?: number;
  modes?: string[];
  allModes?: string[];
  pools?: Pool[];
  modePools?: Record<string, number>;
}

/**
 * Settings → Matchmaking: who may use it, the search window, servers kept
 * free, which modes players can search and the map pool of each mode
 * (`/api/matchmaking/status` and `/api/matchmaking/admin/settings`). Matchmaking
 * is always on; these only tune it.
 */
export function MatchmakingSettingsCard() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [saving, setSaving] = useState(false);
  // null = not loaded.
  const [open, setOpen] = useState<boolean | null>(null);
  const [board, setBoard] = useState(false);
  // The search window as typed (strings, so a field can be emptied while typing).
  const [win, setWin] = useState<Record<keyof SearchWindow, string> | null>(null);
  const [reserved, setReserved] = useState('0');
  const [modes, setModes] = useState<string[]>([]);
  const [allModes, setAllModes] = useState<string[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [modePools, setModePools] = useState<Record<string, number>>({});

  useEffect(() => {
    api
      .get<MatchmakingStatus>('/api/matchmaking/status')
      .then((res) => {
        setOpen(res.openToPlayers !== false);
        setBoard(res.leaderboardPublic === true);
        if (res.searchWindow) setWin(windowStrings(res.searchWindow));
        setReserved(String(res.reservedServers ?? 0));
        setModes(res.modes ?? []);
        setAllModes(res.allModes ?? []);
        setPools(res.pools ?? []);
        setModePools(res.modePools ?? {});
      })
      .catch((err) => showError(apiErrorMessage(err, t('settingsPage.matchmaking.loadFailed'))));
  }, [showError, t]);

  const save = async (patch: {
    openToPlayers?: boolean;
    leaderboardPublic?: boolean;
    searchWindow?: SearchWindow;
    reservedServers?: number;
    modes?: string[];
    modePools?: Record<string, number | null>;
  }) => {
    setSaving(true);
    try {
      const res = await api.put<{
        openToPlayers: boolean;
        leaderboardPublic: boolean;
        searchWindow: SearchWindow;
        reservedServers: number;
        modes: string[];
        modePools: Record<string, number>;
      }>('/api/matchmaking/admin/settings', patch);
      setOpen(res.openToPlayers);
      setBoard(res.leaderboardPublic);
      setWin(windowStrings(res.searchWindow));
      setReserved(String(res.reservedServers));
      setModes(res.modes);
      setModePools(res.modePools ?? {});
      showSuccess(t('settingsPage.matchmaking.saved'));
    } catch (err) {
      showError(apiErrorMessage(err, t('settingsPage.matchmaking.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const modeName = (m: string) => t(`matchmaking.play.modeName.${m}`, { defaultValue: m });

  return (
    <Box data-testid="settings-matchmaking-card">
      <SettingsCardHead title={t('settingsPage.matchmaking.title')} hint={t('settingsPage.matchmaking.short')} />
      {open === null ? null : (
        <Box>
          <SettingsRow
            title={t('settingsPage.matchmaking.openLabel')}
            sub={t('settingsPage.matchmaking.openDescription')}
            control={
              <Switch
                checked={open}
                disabled={saving}
                onChange={(event) => void save({ openToPlayers: event.target.checked })}
                color="primary"
                slotProps={{
                  input: {
                    'data-testid': 'settings-matchmaking-open',
                    'aria-label': t('settingsPage.matchmaking.openLabel'),
                  } as React.InputHTMLAttributes<HTMLInputElement>,
                }}
              />
            }
          />
          <SettingsRow
            title={t('settingsPage.matchmaking.boardLabel')}
            sub={t('settingsPage.matchmaking.boardDescription')}
            control={
              <Switch
                checked={board}
                disabled={saving}
                onChange={(event) => void save({ leaderboardPublic: event.target.checked })}
                color="primary"
                slotProps={{
                  input: {
                    'data-testid': 'settings-matchmaking-board',
                    'aria-label': t('settingsPage.matchmaking.boardLabel'),
                  } as React.InputHTMLAttributes<HTMLInputElement>,
                }}
              />
            }
          />
          <Box sx={{ pt: 2, minWidth: 0 }}>
            {win && (
              <>
                <Typography variant="subtitle2">{t('settingsPage.matchmaking.windowTitle')}</Typography>
                <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                  {t('settingsPage.matchmaking.windowDescription')}
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                  {(['start', 'step', 'cap', 'uncappedAfterMinutes'] as const).map((key) => (
                    <TextField
                      key={key}
                      size="small"
                      type="number"
                      label={t(`settingsPage.matchmaking.window.${key}`)}
                      value={win[key]}
                      onChange={(e) => setWin({ ...win, [key]: e.target.value })}
                      inputProps={{ min: key === 'uncappedAfterMinutes' ? 1 : 0, 'data-testid': `settings-mm-window-${key}` }}
                      sx={{ maxWidth: 160 }}
                    />
                  ))}
                  <Button disabled={saving} onClick={() => void save({ searchWindow: windowFromStrings(win) })} data-testid="settings-mm-window-save">
                    {t('settingsPage.matchmaking.save')}
                  </Button>
                </Stack>
              </>
            )}

            <Typography variant="subtitle2" mt={2}>
              {t('settingsPage.matchmaking.modesTitle')}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block">
              {t('settingsPage.matchmaking.modesDescription')}
            </Typography>
            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 0 }}>
              {allModes.map((m) => (
                <FormControlLabel
                  key={m}
                  label={modeName(m)}
                  control={
                    <Checkbox
                      size="small"
                      checked={modes.includes(m)}
                      disabled={saving || (modes.length === 1 && modes.includes(m))}
                      onChange={(e) => void save({ modes: e.target.checked ? [...modes, m] : modes.filter((x) => x !== m) })}
                      inputProps={{ 'data-testid': `settings-mm-mode-${m}` } as React.InputHTMLAttributes<HTMLInputElement>}
                    />
                  }
                />
              ))}
            </Stack>

            <Typography variant="subtitle2" mt={2}>
              {t('settingsPage.matchmaking.poolsTitle')}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" mb={1}>
              {t('settingsPage.matchmaking.poolsDescription')}
            </Typography>
            <Box
              data-testid="settings-mm-pools"
              sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))', gap: 1.5 }}
            >
              {modes.map((m) => (
                <Box key={m} sx={{ minWidth: 0 }}>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    label={modeName(m)}
                    value={modePools[m] ? String(modePools[m]) : ''}
                    onChange={(e) => void save({ modePools: { [m]: e.target.value ? Number(e.target.value) : null } })}
                    SelectProps={{ displayEmpty: true }}
                    InputLabelProps={{ shrink: true }}
                    inputProps={{ 'data-testid': `settings-mm-pool-${m}` }}
                  >
                    <MenuItem value="">
                      {t(`settingsPage.matchmaking.poolDefault.${m}`, {
                        defaultValue: t('settingsPage.matchmaking.poolDefault.5v5'),
                      })}
                    </MenuItem>
                    {pools.map((p) => (
                      <MenuItem key={p.id} value={String(p.id)}>
                        {p.name} ({p.maps})
                      </MenuItem>
                    ))}
                  </TextField>
                </Box>
              ))}
            </Box>

            <Typography variant="subtitle2" mt={2}>
              {t('settingsPage.matchmaking.reservedTitle')}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" mb={1}>
              {t('settingsPage.matchmaking.reservedDescription')}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                type="number"
                label={t('settingsPage.matchmaking.reservedLabel')}
                value={reserved}
                onChange={(e) => setReserved(e.target.value)}
                inputProps={{ min: 0, max: 50, 'data-testid': 'settings-mm-reserved' }}
                sx={{ maxWidth: 160 }}
              />
              <Button disabled={saving} onClick={() => void save({ reservedServers: Number(reserved) })} data-testid="settings-mm-reserved-save">
                {t('settingsPage.matchmaking.save')}
              </Button>
            </Stack>
          </Box>
        </Box>
      )}
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
