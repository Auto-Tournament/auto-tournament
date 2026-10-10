import { useEffect, useState, type InputHTMLAttributes } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { api, useModuleTranslation, useSnackbar } from '../../../module-sdk';

export interface RecorderGroup {
  id: number;
  name: string;
  enabled: boolean;
}
export function RecorderGroups({
  groups,
  onChanged,
}: {
  groups: RecorderGroup[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  async function change(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await onChanged();
    } catch (e) {
      showError(e instanceof Error ? e.message : t('highlightsAdmin.actionError'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Box>
      <Typography variant="h6">{t('highlightsAdmin.fleet.groups')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t('highlightsAdmin.fleet.drainHelp')}
      </Typography>
      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2}>
        {groups.map((g) => (
          <FormControlLabel
            key={g.id}
            label={g.name}
            control={
              <Switch
                checked={g.enabled}
                disabled={busy}
                slotProps={{
                  input: {
                    'aria-label': g.name,
                    'data-testid': `recorder-group-toggle-${g.id}`,
                  } as InputHTMLAttributes<HTMLInputElement>,
                }}
                onChange={(_e, enabled) =>
                  void change(() => api.put(`/api/game/cs2/recorder-groups/${g.id}`, { enabled }))
                }
              />
            }
          />
        ))}
      </Stack>
      <Stack
        component="form"
        direction="row"
        spacing={1}
        sx={{ mt: 1 }}
        onSubmit={(e) => {
          e.preventDefault();
          void change(async () => {
            await api.post('/api/game/cs2/recorder-groups', { name: name.trim() });
            setName('');
          });
        }}
      >
        <TextField
          size="small"
          label={t('highlightsAdmin.fleet.groupName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          inputProps={{ maxLength: 80, 'data-testid': 'recorder-group-name' }}
        />
        <Button type="submit" disabled={busy || !name.trim()} data-testid="recorder-group-create">
          {t('highlightsAdmin.fleet.createGroup')}
        </Button>
      </Stack>
    </Box>
  );
}

export function RecorderControls({
  name,
  enabled,
  groupId,
  groups,
  onChanged,
}: {
  name: string;
  enabled: boolean;
  groupId: number | null;
  groups: RecorderGroup[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const [busy, setBusy] = useState(false);
  async function save(body: { enabled?: boolean; groupId?: number | null }) {
    setBusy(true);
    try {
      await api.put(`/api/game/cs2/recorders/${encodeURIComponent(name)}/controls`, body);
      await onChanged();
    } catch (e) {
      showError(e instanceof Error ? e.message : t('highlightsAdmin.actionError'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
      <FormControlLabel
        label={t('highlightsAdmin.fleet.enabled')}
        control={
          <Switch
            checked={enabled}
            disabled={busy}
            slotProps={{
              input: {
                'data-testid': `recorder-toggle-${name}`,
              } as InputHTMLAttributes<HTMLInputElement>,
            }}
            onChange={(_e, value) => void save({ enabled: value })}
          />
        }
      />
      <TextField
        select
        size="small"
        label={t('highlightsAdmin.fleet.group')}
        value={groupId ?? ''}
        disabled={busy}
        sx={{ minWidth: 180 }}
        onChange={(e) =>
          void save({ groupId: e.target.value === '' ? null : Number(e.target.value) })
        }
        SelectProps={{ inputProps: { 'data-testid': `recorder-group-${name}` } }}
      >
        <MenuItem value="">{t('highlightsAdmin.fleet.ungrouped')}</MenuItem>
        {groups.map((g) => (
          <MenuItem key={g.id} value={g.id}>
            {g.name}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}

export function MatchRecordingGroup({ slug }: { slug: string }) {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const [data, setData] = useState<{ groups: RecorderGroup[]; groupId: number | null } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<{ groups: RecorderGroup[] }>('/api/game/cs2/recorder-groups'),
      api.get<{ groupId: number | null }>(
        `/api/game/cs2/matches/${encodeURIComponent(slug)}/recording-group`
      ),
    ])
      .then(([a, b]) => {
        if (!cancelled) setData({ groups: a.groups, groupId: b.groupId });
      })
      .catch((e) => {
        if (!cancelled) showError(e instanceof Error ? e.message : t('highlightsAdmin.loadError'));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, showError, t]);
  if (!data) return null;
  async function save(groupId: number | null) {
    setBusy(true);
    try {
      await api.put(`/api/game/cs2/matches/${encodeURIComponent(slug)}/recording-group`, {
        groupId,
      });
      setData((current) => (current ? { ...current, groupId } : null));
    } catch (e) {
      showError(e instanceof Error ? e.message : t('highlightsAdmin.actionError'));
    } finally {
      setBusy(false);
    }
  }
  const selected = data.groups.find((g) => g.id === data.groupId);
  return (
    <Box sx={{ mb: 2 }}>
      <TextField
        select
        size="small"
        label={t('highlightsAdmin.fleet.matchGroup')}
        value={data.groupId ?? ''}
        disabled={busy}
        sx={{ minWidth: 220 }}
        helperText={t('highlightsAdmin.fleet.matchHelp')}
        onChange={(e) => void save(e.target.value === '' ? null : Number(e.target.value))}
        SelectProps={{ inputProps: { 'data-testid': `match-recording-group-${slug}` } }}
      >
        <MenuItem value="">{t('highlightsAdmin.fleet.allGroups')}</MenuItem>
        {data.groups.map((g) => (
          <MenuItem key={g.id} value={g.id}>
            {g.name}
          </MenuItem>
        ))}
      </TextField>
      {selected && !selected.enabled && (
        <Alert severity="info" sx={{ mt: 1 }}>
          {t('highlightsAdmin.fleet.groupDisabledHelp')}
        </Alert>
      )}
    </Box>
  );
}
