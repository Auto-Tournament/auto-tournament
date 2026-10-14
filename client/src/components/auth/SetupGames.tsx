/**
 * The last step of /setup on a fresh install: which games this site runs.
 * Counter-Strike 2 (own servers, every round read from them) on top; the
 * games whose results players report (catalog packs) below, searchable.
 * Installs what is picked through the catalog, as Modules does.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { postJson } from '../../utils/postJson';

interface CatalogItem {
  kind: 'module' | 'pack';
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  state: string;
}

export function SetupGames({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [cs2, setCs2] = useState(true);
  const [packs, setPacks] = useState<CatalogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/catalog', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d: { items?: CatalogItem[] }) => setItems(d.items ?? []))
      .catch(() => setItems([]));
  }, []);

  const cs2Item = useMemo(() => items?.find((i) => i.kind === 'module' && i.id === 'cs2'), [items]);
  const packOptions = useMemo(
    () => (items ?? []).filter((i) => i.kind === 'pack' && i.state === 'available'),
    [items]
  );
  const cs2Open = !!cs2Item && cs2Item.state !== 'installed';

  const install = async () => {
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    if (cs2 && cs2Open) {
      const { status } = await postJson('/api/catalog/modules/cs2/install', {});
      if (status !== 200) failed.push(cs2Item?.name ?? 'Counter-Strike 2');
    }
    for (const p of packs) {
      const { status } = await postJson(
        `/api/catalog/packs/${encodeURIComponent(p.id)}/install`,
        {}
      );
      if (status !== 200) failed.push(p.name);
    }
    setBusy(false);
    if (failed.length) return setError(t('adminSetup.games.failed', { names: failed.join(', ') }));
    onDone();
  };

  if (items === null) return <LinearProgress aria-label={t('adminSetup.games.title')} />;

  return (
    <Stack spacing={2.5} data-testid="setup-games">
      {cs2Item && (
        <Box
          component="label"
          sx={{
            display: 'flex',
            gap: 1.5,
            alignItems: 'flex-start',
            p: 1.5,
            border: 1,
            borderColor: cs2 && cs2Open ? 'primary.main' : 'divider',
            borderRadius: 1,
            cursor: cs2Open ? 'pointer' : 'default',
          }}
        >
          <Checkbox
            checked={cs2 || !cs2Open}
            disabled={!cs2Open}
            onChange={(e) => setCs2(e.target.checked)}
            inputProps={{ 'aria-label': cs2Item.name }}
            data-testid="setup-games-cs2"
            sx={{ p: 0.5 }}
          />
          {cs2Item.icon && (
            <Box component="img" src={cs2Item.icon} alt="" sx={{ width: 36, height: 36 }} />
          )}
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 600 }}>
              {cs2Item.name}
              {!cs2Open && ` · ${t('adminSetup.games.installed')}`}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('adminSetup.games.cs2Help')}
            </Typography>
          </Box>
        </Box>
      )}
      {packOptions.length > 0 && (
        <Autocomplete
          multiple
          options={packOptions}
          value={packs}
          onChange={(_e, v) => setPacks(v)}
          getOptionLabel={(o) => o.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderInput={(params) => (
            <TextField
              {...params}
              label={t('adminSetup.games.others')}
              helperText={t('adminSetup.games.othersHelp')}
              inputProps={{ ...params.inputProps, 'data-testid': 'setup-games-packs' }}
            />
          )}
        />
      )}
      {error && <Alert severity="error">{error}</Alert>}
      <Button
        variant="contained"
        size="large"
        disabled={busy}
        onClick={() => void install()}
        data-testid="setup-games-submit"
      >
        {t('adminSetup.games.continue')}
      </Button>
      <Button onClick={onDone} disabled={busy} data-testid="setup-games-skip">
        {t('adminSetup.games.skip')}
      </Button>
    </Stack>
  );
}
