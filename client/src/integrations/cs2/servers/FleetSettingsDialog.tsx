/**
 * The Ready Up server settings form (FLEET.md §7.5 server.config + the match
 * plugin's settings.set), for the fleet default or one server's override.
 * Every field can stay empty: in the default that means "not sent" (the
 * server keeps its own value), in an override "use the fleet default".
 */

import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useModuleTranslation } from '../../../module-sdk';
import type { FleetSettingsValue } from './fleetPush.types';

type Kind = 'text' | 'int' | 'bool' | 'secret' | 'html';
interface FieldSpec {
  path: string;
  kind: Kind;
  group: 'config' | 'match';
  /** Ready Up applies it today (the rest is stored on the server for later). */
  applied: boolean;
  max?: number;
}

export const FLEET_SETTING_FIELDS: FieldSpec[] = [
  { path: 'config.hostname_format', kind: 'text', group: 'config', applied: true },
  { path: 'config.scrim_knife', kind: 'bool', group: 'config', applied: true },
  {
    path: 'config.series_end_kick_delay.no_demo',
    kind: 'int',
    group: 'config',
    applied: true,
    max: 3600,
  },
  {
    path: 'config.series_end_kick_delay.demo_no_upload',
    kind: 'int',
    group: 'config',
    applied: true,
    max: 3600,
  },
  {
    path: 'config.series_end_kick_delay.demo_upload',
    kind: 'int',
    group: 'config',
    applied: true,
    max: 3600,
  },
  { path: 'config.chat_prefix', kind: 'text', group: 'config', applied: false },
  { path: 'config.admin_chat_prefix', kind: 'text', group: 'config', applied: false },
  { path: 'config.demo.path', kind: 'text', group: 'config', applied: false },
  { path: 'config.demo.name_format', kind: 'text', group: 'config', applied: false },
  { path: 'config.offline_pause_minutes', kind: 'int', group: 'config', applied: false, max: 1440 },
  { path: 'config.scrim_when_idle', kind: 'bool', group: 'config', applied: false },
  { path: 'config.warmup.respawn', kind: 'bool', group: 'config', applied: false },
  { path: 'config.warmup.money', kind: 'int', group: 'config', applied: false, max: 65535 },
  { path: 'config.warmup.message_html', kind: 'html', group: 'config', applied: false },
  { path: 'config.status_http.token', kind: 'secret', group: 'config', applied: false },
  { path: 'match.minimum_ready_required', kind: 'int', group: 'match', applied: true, max: 32 },
  { path: 'match.playout_enabled_default', kind: 'bool', group: 'match', applied: true },
  { path: 'match.autoready_enabled', kind: 'bool', group: 'match', applied: true },
  {
    path: 'match.use_pause_command_for_tactical_pause',
    kind: 'bool',
    group: 'match',
    applied: true,
  },
  { path: 'match.kick_when_no_match_loaded', kind: 'bool', group: 'match', applied: true },
  { path: 'match.whitelist_enabled_default', kind: 'bool', group: 'match', applied: true },
  { path: 'match.reset_cvars_on_series_end', kind: 'bool', group: 'match', applied: true },
];

type Form = Record<string, string>;

function read(obj: unknown, path: string[]): unknown {
  let cur = obj;
  for (const p of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function write(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cur = obj;
  for (const p of path.slice(0, -1)) {
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
}

export function settingsToForm(value: FleetSettingsValue | null): Form {
  const form: Form = {};
  for (const f of FLEET_SETTING_FIELDS) {
    if (f.kind === 'secret') {
      form[f.path] = '';
      continue;
    }
    const v = read(value, f.path.split('.'));
    form[f.path] = v === undefined || v === null ? '' : String(v);
  }
  return form;
}

/** The API body from the form; `errors` names fields that are not valid numbers. */
export function formToSettings(form: Form): { value: FleetSettingsValue; errors: string[] } {
  const out: Record<string, unknown> = { config: {}, match: {} };
  const errors: string[] = [];
  for (const f of FLEET_SETTING_FIELDS) {
    const raw = (form[f.path] ?? '').trim();
    if (f.kind === 'secret') {
      if (form[f.path] === '\u0000clear') write(out, f.path.split('.'), '');
      else if (raw) write(out, f.path.split('.'), raw);
      continue;
    }
    if (raw === '') continue;
    if (f.kind === 'int') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || (f.max !== undefined && n > f.max)) errors.push(f.path);
      else write(out, f.path.split('.'), n);
    } else if (f.kind === 'bool') {
      write(out, f.path.split('.'), raw === 'true');
    } else {
      write(out, f.path.split('.'), f.kind === 'html' ? form[f.path] : raw);
    }
  }
  return { value: out as unknown as FleetSettingsValue, errors };
}

interface Props {
  open: boolean;
  title: string;
  /** Override mode: an empty field inherits `inherited`. */
  inherited?: FleetSettingsValue | null;
  initial: FleetSettingsValue | null;
  saving: boolean;
  onClose: () => void;
  onSave: (value: FleetSettingsValue) => void;
  /** Override mode: drop the override altogether. */
  onClear?: () => void;
}

export default function FleetSettingsDialog(props: Props) {
  // A fresh form every time the dialog opens (the key remounts it).
  return props.open ? <SettingsForm key={JSON.stringify(props.initial)} {...props} /> : null;
}

function SettingsForm({
  open,
  title,
  inherited,
  initial,
  saving,
  onClose,
  onSave,
  onClear,
}: Props) {
  const { t } = useModuleTranslation('cs2');
  const [form, setForm] = useState<Form>(() => settingsToForm(initial));
  const [errors, setErrors] = useState<string[]>([]);
  const override = inherited !== undefined;
  const inheritedForm = override ? settingsToForm(inherited ?? null) : null;

  const label = (path: string) =>
    t(`fleetPush.fields.${path.replace(/\./g, '_')}`, {
      defaultValue: path.split('.').slice(1).join('.'),
    });
  const emptyLabel = (path: string) => {
    if (!override) return t('fleetPush.notSent', { defaultValue: 'Not sent' });
    const v = inheritedForm?.[path];
    return v
      ? t('fleetPush.inheritValue', { value: v, defaultValue: 'Fleet default ({{value}})' })
      : t('fleetPush.inherit', { defaultValue: 'Fleet default' });
  };

  const submit = () => {
    const { value, errors: bad } = formToSettings(form);
    setErrors(bad);
    if (bad.length === 0) onSave(value);
  };

  const field = (f: FieldSpec) => {
    const common = {
      size: 'small' as const,
      fullWidth: true,
      label: label(f.path),
      error: errors.includes(f.path),
      helperText: f.applied
        ? undefined
        : t('fleetPush.notAppliedYet', {
            defaultValue: 'Stored on the server; Ready Up does not use it yet',
          }),
      inputProps: { 'data-testid': `fleet-setting-${f.path}` },
    };
    if (f.kind === 'bool') {
      return (
        <TextField
          key={f.path}
          {...common}
          select
          value={form[f.path] ?? ''}
          onChange={(e) => setForm({ ...form, [f.path]: e.target.value })}
          SelectProps={{ displayEmpty: true }}
          InputLabelProps={{ shrink: true }}
        >
          <MenuItem value="">
            <em>{emptyLabel(f.path)}</em>
          </MenuItem>
          <MenuItem value="true">{t('fleetPush.on', { defaultValue: 'On' })}</MenuItem>
          <MenuItem value="false">{t('fleetPush.off', { defaultValue: 'Off' })}</MenuItem>
        </TextField>
      );
    }
    if (f.kind === 'secret') {
      const set = initial?.statusTokenSet ?? false;
      return (
        <Stack key={f.path} direction="row" gap={1} alignItems="flex-start">
          <TextField
            {...common}
            type="password"
            autoComplete="new-password"
            value={form[f.path] === '\u0000clear' ? '' : (form[f.path] ?? '')}
            placeholder={
              set ? t('fleetPush.tokenSet', { defaultValue: 'Set (leave empty to keep it)' }) : ''
            }
            onChange={(e) => setForm({ ...form, [f.path]: e.target.value })}
            InputLabelProps={{ shrink: true }}
          />
          {set && (
            <Button
              size="small"
              onClick={() => setForm({ ...form, [f.path]: '\u0000clear' })}
              disabled={form[f.path] === '\u0000clear'}
            >
              {t('fleetPush.clearToken', { defaultValue: 'Clear' })}
            </Button>
          )}
        </Stack>
      );
    }
    return (
      <TextField
        key={f.path}
        {...common}
        multiline={f.kind === 'html'}
        minRows={f.kind === 'html' ? 2 : undefined}
        type={f.kind === 'int' ? 'number' : 'text'}
        value={form[f.path] ?? ''}
        placeholder={emptyLabel(f.path)}
        onChange={(e) => setForm({ ...form, [f.path]: e.target.value })}
        InputLabelProps={{ shrink: true }}
      />
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" mb={2}>
          {override
            ? t('fleetPush.overrideHelp', {
                defaultValue:
                  'Empty fields use the fleet default. A field you empty keeps its last value on the server until something sets it again.',
              })
            : t('fleetPush.defaultHelp', {
                defaultValue:
                  'Sent to every Ready Up server (server.config and settings.set) when you save, and again when a server reconnects with an older version. Empty fields are not sent.',
              })}
        </Typography>
        <Typography variant="subtitle2" fontWeight={600} mb={1}>
          {t('fleetPush.serverConfig', { defaultValue: 'Server config' })}
        </Typography>
        <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '1fr 1fr' }} gap={2} mb={3}>
          {FLEET_SETTING_FIELDS.filter((f) => f.group === 'config').map(field)}
        </Box>
        <Typography variant="subtitle2" fontWeight={600} mb={1}>
          {t('fleetPush.matchSettings', { defaultValue: 'Match plugin settings' })}
        </Typography>
        <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '1fr 1fr' }} gap={2}>
          {FLEET_SETTING_FIELDS.filter((f) => f.group === 'match').map(field)}
        </Box>
      </DialogContent>
      <DialogActions>
        {onClear && (
          <Button color="error" onClick={onClear} disabled={saving} sx={{ mr: 'auto' }}>
            {t('fleetPush.clearOverride', { defaultValue: 'Use the fleet default' })}
          </Button>
        )}
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={saving}
          data-testid="fleet-settings-save"
        >
          {t('fleetPush.saveAndPush', { defaultValue: 'Save and push' })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
