import { useState } from 'react';
import { Box, Button, Chip, TextField, Typography } from '@mui/material';
import {
  api,
  apiErrorMessage,
  ConfirmDialog,
  mono,
  radii,
  tokens,
  useModuleTranslation,
  useSnackbar,
} from '../../../../module-sdk';
import type { PluginSetValue } from '../fleetPush.types';
import PluginSetPicker, { presetValue, usePluginCatalog } from '../PluginSetPicker';
import { SideSheet } from '../fleet/SideSheet';
import type { ServerSetup } from './SetupsSection';

const { color } = tokens;

/** Maps shown before "+N more". */
const SHOWN_MAPS = 8;

/**
 * The New setup / Edit setup sheet: a name, a plugin set (the house picker) and a map pool.
 * Map names, Workshop ids and links are checked by the API (serverSetups.ts mapEntryOf).
 */
export function SetupEditor({
  setup,
  onClose,
  onSaved,
}: {
  /** 'new', a setup to edit, or null (closed). */
  setup: ServerSetup | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = setup !== null;
  // A fresh form each time it opens (keyed below).
  return (
    <SideSheet
      open={open}
      onClose={onClose}
      testId="setup-editor"
      title={<Title setup={setup} />}
      subtitle={<Subtitle />}
    >
      {open && (
        <Form
          key={setup === 'new' ? 'new' : setup.id}
          setup={setup}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </SideSheet>
  );
}

function Title({ setup }: { setup: ServerSetup | 'new' | null }) {
  const { t } = useModuleTranslation('cs2');
  return <>{setup && setup !== 'new' ? t('setups.editTitle') : t('setups.newTitle')}</>;
}

function Subtitle() {
  const { t } = useModuleTranslation('cs2');
  return <>{t('setups.editorAbout')}</>;
}

function Form({
  setup,
  onClose,
  onSaved,
}: {
  setup: ServerSetup | 'new';
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const { catalog } = usePluginCatalog();
  const editing = setup !== 'new' ? setup : null;
  const [name, setName] = useState(editing?.name ?? '');
  const [plugins, setPlugins] = useState<PluginSetValue | null>(editing?.plugins ?? null);
  const [maps, setMaps] = useState<string[]>(editing?.maps ?? []);
  const [mapInput, setMapInput] = useState('');
  const [allMaps, setAllMaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = plugins ?? (catalog ? presetValue(catalog, 'practice') : null);
  const addMap = () => {
    const entries = mapInput
      .split(/[\s,]+/)
      .map((m) => m.trim())
      .filter(Boolean);
    if (entries.length === 0) return;
    setMaps((prev) => [...prev, ...entries.filter((e) => !prev.includes(e))]);
    setMapInput('');
  };

  const save = async () => {
    if (!set) return;
    setBusy(true);
    try {
      await api.put('/api/game/cs2/setups', { name: name.trim(), plugins: set, maps });
      // Renamed: the old one goes (a setup's id comes from its name).
      if (editing && editing.name.trim() !== name.trim())
        await api.delete(`/api/game/cs2/setups/${encodeURIComponent(editing.id)}`);
      onSaved();
    } catch (error) {
      showError(apiErrorMessage(error, t('setups.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    try {
      await api.delete(`/api/game/cs2/setups/${encodeURIComponent(editing.id)}`);
      onSaved();
    } catch (error) {
      showError(apiErrorMessage(error, t('setups.deleteFailed')));
    }
  };

  const shown = allMaps ? maps : maps.slice(0, SHOWN_MAPS);
  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      sx={{ display: 'flex', flexDirection: 'column', gap: 2.75 }}
    >
      <TextField
        label={t('setups.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        size="small"
        required
        slotProps={{ htmlInput: { maxLength: 40, 'data-testid': 'setup-name' } }}
      />

      <Box>
        <Typography sx={{ mb: 1, fontSize: '0.8125rem', color: color.ink2 }}>
          {t('setups.plugins')}
        </Typography>
        {catalog && set && (
          <PluginSetPicker catalog={catalog} value={set} onChange={(v) => setPlugins(v)} />
        )}
        <Typography sx={{ mt: 0.75, fontSize: '0.75rem', color: color.muted }}>
          {t('setups.alwaysOn')}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography sx={{ fontSize: '0.8125rem', color: color.ink2 }}>
          {t('setups.maps')}
        </Typography>
        {maps.length > 0 && (
          <Box
            role="list"
            aria-label={t('setups.mapPool')}
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}
          >
            {shown.map((m) => (
              <Chip
                key={m}
                role="listitem"
                label={m}
                size="small"
                onDelete={() => setMaps((prev) => prev.filter((x) => x !== m))}
                sx={{ ...mono, fontSize: '0.75rem', bgcolor: color.paper3 }}
              />
            ))}
            {!allMaps && maps.length > SHOWN_MAPS && (
              <Chip
                label={t('setups.moreMaps', { count: maps.length - SHOWN_MAPS })}
                size="small"
                variant="outlined"
                onClick={() => setAllMaps(true)}
                sx={{ borderStyle: 'dashed' }}
              />
            )}
          </Box>
        )}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            fullWidth
            value={mapInput}
            onChange={(e) => setMapInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addMap();
              }
            }}
            placeholder={t('setups.mapPlaceholder')}
            slotProps={{
              htmlInput: {
                'aria-label': t('setups.addMapLabel'),
                'data-testid': 'setup-map-input',
                style: { fontFamily: mono.fontFamily },
              },
            }}
          />
          <Button variant="outlined" onClick={addMap} sx={{ borderRadius: radii.pill }}>
            {t('setups.addMap')}
          </Button>
        </Box>
        <Typography sx={{ fontSize: '0.75rem', color: color.muted }}>
          {t('setups.mapsHint')}
        </Typography>
      </Box>

      <Box
        sx={{
          display: 'flex',
          gap: 1.25,
          pt: 2,
          borderTop: `1px solid ${color.rule}`,
          alignItems: 'center',
        }}
      >
        <Button
          type="submit"
          variant="contained"
          disabled={busy || !name.trim() || maps.length === 0 || !set}
          data-testid="setup-save"
          sx={{ borderRadius: radii.pill }}
        >
          {t('setups.save')}
        </Button>
        <Button onClick={onClose} sx={{ color: color.ink2 }}>
          {t('setups.cancel')}
        </Button>
        {editing && (
          <Button
            onClick={() => setConfirmDelete(true)}
            sx={{ ml: 'auto', color: color.ban }}
            data-testid="setup-delete"
          >
            {t('setups.delete')}
          </Button>
        )}
      </Box>
      <ConfirmDialog
        open={confirmDelete}
        title={t('setups.deleteTitle', { name: editing?.name ?? '' })}
        message={t('setups.deleteMessage')}
        confirmLabel={t('setups.delete')}
        confirmColor="error"
        onConfirm={() => {
          setConfirmDelete(false);
          void remove();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </Box>
  );
}
