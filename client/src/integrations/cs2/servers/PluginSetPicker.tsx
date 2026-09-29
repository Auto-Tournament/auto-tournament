/**
 * Picks the Ready Up plugins a server runs: a preset (Tournament, Practice,
 * Fun) or plugins ticked one by one. Required plugins (fleet, match) are
 * always ticked. Used by "Create server" / "Create several" (Machines), a
 * server's Plugins dialog and the fleet default (Fleet settings). The API is
 * `/api/fleet/plugins` (fleet/push/pluginSets.ts).
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Checkbox, FormControlLabel, Stack, Typography } from '@mui/material';
import { api, SegmentedControl, useModuleTranslation } from '../../../module-sdk';
import type {
  PluginCatalogResponse,
  PluginPreset,
  PluginPresetName,
  PluginSetValue,
} from './fleetPush.types';

const PRESETS: PluginPresetName[] = ['tournament', 'practice', 'fun'];

function fetchCatalog(): Promise<PluginCatalogResponse | null> {
  return api.get<PluginCatalogResponse>('/api/fleet/plugins').catch((err: unknown) => {
    console.error('Failed to load the Ready Up plugin catalog', err);
    return null;
  });
}

/** The plugin catalog and the fleet default set, loaded whenever `open` turns true. */
export function usePluginCatalog(open = true): {
  catalog: PluginCatalogResponse | null;
  reload: () => Promise<void>;
} {
  const [catalog, setCatalog] = useState<PluginCatalogResponse | null>(null);
  const reload = useCallback(async () => {
    const next = await fetchCatalog();
    if (next) setCatalog(next);
  }, []);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void fetchCatalog().then((next) => {
      if (live && next) setCatalog(next);
    });
    return () => {
      live = false;
    };
  }, [open]);
  return { catalog, reload };
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** The set for a preset, from the catalog. */
export function presetValue(
  catalog: PluginCatalogResponse,
  preset: PluginPresetName
): PluginSetValue {
  return { preset, plugins: [...catalog.presets[preset]] };
}

/** The preset whose plugins these are, else custom. */
function presetOf(catalog: PluginCatalogResponse, plugins: string[]): PluginPreset {
  return PRESETS.find((p) => sameSet(catalog.presets[p], plugins)) ?? 'custom';
}

/** Picked plugins the server does not have. */
export function notInstalled(
  value: PluginSetValue | null,
  installed: string[] | null | undefined
): string[] {
  if (!value || !installed) return [];
  return value.plugins.filter((p) => !installed.includes(p));
}

/** Whether csm's default bundle lacks some of the picked plugins (a create then installs the full one). */
export function needsFullBundle(
  catalog: PluginCatalogResponse,
  value: PluginSetValue | null
): boolean {
  return !!value && value.plugins.some((p) => !catalog.essentialsBundle.includes(p));
}

interface Props {
  catalog: PluginCatalogResponse;
  /** null = no set of its own (`nullLabel` says what happens then). */
  value: PluginSetValue | null;
  onChange: (value: PluginSetValue | null) => void;
  /** Offer "no set" as the first choice, with this label (e.g. "Fleet default"). */
  nullLabel?: string;
  /** What the server has installed (hello), for the "not installed" warning. */
  installed?: string[] | null;
  /** Say that a create installs the full bundle when the set needs it. */
  showBundleNote?: boolean;
  disabled?: boolean;
  testId?: string;
}

export default function PluginSetPicker({
  catalog,
  value,
  onChange,
  nullLabel,
  installed,
  showBundleNote = false,
  disabled = false,
  testId = 'plugin-set-picker',
}: Props) {
  const { t } = useModuleTranslation('cs2');
  const presetLabel = (p: PluginPreset | 'none') =>
    p === 'none'
      ? (nullLabel ?? '')
      : t(`pluginSets.preset.${p}`, {
          defaultValue: {
            tournament: 'Tournament',
            practice: 'Practice',
            fun: 'Fun',
            custom: 'Custom',
          }[p],
        });

  const options = [
    ...(nullLabel !== undefined
      ? [{ value: 'none' as const, label: presetLabel('none'), testId: `${testId}-none` }]
      : []),
    ...([...PRESETS, 'custom'] as PluginPreset[]).map((p) => ({
      value: p,
      label: presetLabel(p),
      testId: `${testId}-${p}`,
    })),
  ];
  // What the checkboxes show when there is no set of its own: the fleet default, else everything.
  const shown = value ??
    catalog.default ?? { preset: 'custom' as const, plugins: [...catalog.catalog] };

  const pick = (choice: PluginPreset | 'none') => {
    if (choice === 'none') onChange(null);
    else if (choice === 'custom') onChange({ preset: 'custom', plugins: [...shown.plugins] });
    else onChange(presetValue(catalog, choice));
  };

  const toggle = (plugin: string, on: boolean) => {
    const set = new Set(shown.plugins);
    if (on) set.add(plugin);
    else set.delete(plugin);
    for (const r of catalog.required) set.add(r);
    const plugins = catalog.catalog.filter((p) => set.has(p));
    onChange({ preset: presetOf(catalog, plugins), plugins });
  };

  const missing = notInstalled(value, installed);
  const pluginName = (p: string) => t(`pluginSets.plugin.${p}`, { defaultValue: p });

  return (
    <Stack gap={1.5} data-testid={testId}>
      <SegmentedControl
        label={t('pluginSets.presetLabel', { defaultValue: 'Plugin preset' })}
        value={value ? value.preset : 'none'}
        options={options}
        onChange={pick}
        disabled={disabled}
      />
      {value === null && nullLabel !== undefined ? (
        <Typography variant="body2" color="text.secondary">
          {catalog.default
            ? t('pluginSets.usesDefault', {
                defaultValue: 'Uses the fleet default: {{plugins}}.',
                plugins: catalog.default.plugins.map(pluginName).join(', '),
              })
            : t('pluginSets.keepsBundle', {
                defaultValue:
                  'No default set: the server keeps the plugins its Ready Up bundle loads.',
              })}
        </Typography>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            columnGap: 2,
          }}
        >
          {catalog.catalog.map((plugin) => {
            const required = catalog.required.includes(plugin);
            return (
              <FormControlLabel
                key={plugin}
                disabled={disabled || required}
                control={
                  <Checkbox
                    size="small"
                    checked={required || shown.plugins.includes(plugin)}
                    onChange={(e) => toggle(plugin, e.target.checked)}
                    inputProps={{ 'aria-describedby': `${testId}-${plugin}-help` }}
                    data-testid={`${testId}-plugin-${plugin}`}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2">{pluginName(plugin)}</Typography>
                    <Typography
                      id={`${testId}-${plugin}-help`}
                      variant="caption"
                      color="text.secondary"
                      display="block"
                    >
                      {required
                        ? t('pluginSets.required', { defaultValue: 'Always on' })
                        : t(`pluginSets.pluginHelp.${plugin}`, { defaultValue: '' })}
                    </Typography>
                  </Box>
                }
                sx={{ alignItems: 'flex-start', my: 0.25, '& .MuiCheckbox-root': { pt: 0.25 } }}
              />
            );
          })}
        </Box>
      )}
      {missing.length > 0 && (
        <Alert severity="warning" data-testid={`${testId}-missing`}>
          {t('pluginSets.notInstalled', {
            defaultValue:
              'Not installed on this server: {{plugins}}. They stay off until Ready Up is updated with the "With skins" bundle.',
            plugins: missing.map(pluginName).join(', '),
          })}
        </Alert>
      )}
      {showBundleNote && needsFullBundle(catalog, value ?? catalog.default) && (
        <Typography variant="body2" color="text.secondary">
          {t('pluginSets.fullBundleNote', {
            defaultValue:
              'Some of these plugins need the full Ready Up bundle; the new servers get it.',
          })}
        </Typography>
      )}
    </Stack>
  );
}
