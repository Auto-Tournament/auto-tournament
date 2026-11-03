/**
 * The pieces of the setup's Match settings step (Cs2MatchSettings.tsx): the preset picker with
 * the site's saved presets, the orange "Site: X · Reset" mark, a section, the site's defaults,
 * and the spectator and prize fields.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ListSubheader,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import {
  api,
  apiErrorMessage,
  SwitchRow,
  useModuleTranslation,
  useSnackbar,
} from '../../../module-sdk';
import { RULE_COUNTS, RULE_FLAGS, type Cs2TournamentSettings } from './cs2TournamentSettings';
import { withPreset, type SiteMatchDefaults } from './matchPresetRules';

type Update = (patch: Partial<Cs2TournamentSettings>) => void;

/** Until the site's settings load (or for someone who can't read them): Ready Up's defaults. */
const SITE_FALLBACK: SiteMatchDefaults = {
  teamReady: true,
  giveUpVote: false,
  autoStartMinutes: 0,
};

/** The site's Match rules, which the orange marks compare with. */
export function useSiteMatchDefaults(): SiteMatchDefaults {
  const [site, setSite] = useState<SiteMatchDefaults>(SITE_FALLBACK);
  useEffect(() => {
    let live = true;
    api
      .get<{ settings?: Record<string, unknown> }>('/api/settings')
      .then((res) => {
        const st = res.settings ?? {};
        if (!live) return;
        setSite({
          teamReady: st.atTeamReady !== false,
          giveUpVote: st.atGgEnabled === 1 || st.atGgEnabled === true,
          autoStartMinutes:
            typeof st.atAutostartAfterMinutes === 'number' ? st.atAutostartAfterMinutes : 0,
        });
      })
      .catch(() => undefined); // no marks against the real site values; the fallback stands
    return () => {
      live = false;
    };
  }, []);
  return site;
}

/** "Site: 5 min · Reset" under a setting that differs from the site's defaults. */
export function SiteMark({ site, onReset }: { site: string; onReset: () => void }) {
  const { t } = useModuleTranslation('cs2');
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }} data-testid="site-mark">
      <Box
        component="span"
        aria-hidden
        sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main' }}
      />
      <Typography variant="body2" color="primary.main">
        {site}
      </Typography>
      <Button
        size="small"
        onClick={onReset}
        sx={{ minWidth: 0, px: 1, textDecoration: 'underline' }}
        color="inherit"
      >
        {t('tournament.matchSettings.reset')}
      </Button>
    </Box>
  );
}

export function Section({
  title,
  help,
  children,
}: {
  title: string;
  help: string;
  children: ReactNode;
}) {
  return (
    <Box sx={{ display: 'grid', gap: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
      <Box>
        <Typography component="h3" fontWeight={600}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {help}
        </Typography>
      </Box>
      {children}
    </Box>
  );
}

interface SavedPreset {
  id: string;
  name: string;
  settings: Partial<Cs2TournamentSettings>;
}

/** The match settings a preset keeps (the API's matchPresets.ts takes the same). */
const PRESET_FIELDS = [
  'esportsMode',
  'fillTeamsWithBots',
  'highlights',
  'skinRewards',
  'maxRounds',
  'overtimeMode',
  'overtimeSegments',
  'autoStartMinutes',
  'connectVia',
  ...RULE_FLAGS,
  ...RULE_COUNTS,
] as const;

function presetFieldsOf(v: Cs2TournamentSettings): Partial<Cs2TournamentSettings> {
  const out: Partial<Cs2TournamentSettings> = {};
  for (const key of PRESET_FIELDS) {
    if (v[key] !== undefined && v[key] !== null) Object.assign(out, { [key]: v[key] });
  }
  return out;
}

/** The saved preset the tournament matches field for field, if any. */
function savedMatch(v: Cs2TournamentSettings, presets: SavedPreset[]): SavedPreset | undefined {
  const key = (o: object) =>
    JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const mine = key(presetFieldsOf(v));
  return presets.find((p) => key(p.settings) === mine);
}

/** The preset dropdown (Standard, Valve official, the site's saved ones), Save, and the changed count. */
export function PresetPicker({
  value,
  changedCount,
  update,
  onResetAll,
  disabled,
}: {
  value: Cs2TournamentSettings;
  changedCount: number;
  update: Update;
  onResetAll: () => void;
  disabled: boolean;
}) {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const load = useCallback(() => {
    api
      .get<{ presets?: SavedPreset[] }>('/api/game/cs2/match-presets')
      .then((r) => setPresets(r.presets ?? []))
      .catch(() => setPresets([]));
  }, []);
  useEffect(load, [load]);
  const saved = savedMatch(value, presets);
  const base = value.esportsMode ? 'esports' : 'standard';
  const selected = saved?.id ?? base;
  const pick = (id: string) => {
    if (id === 'standard' || id === 'esports') return update(withPreset(id === 'esports'));
    const p = presets.find((x) => x.id === id);
    if (p) update({ ...withPreset(p.settings.esportsMode === true), ...p.settings });
  };
  const save = async () => {
    const name = (saving ?? '').trim();
    if (!name) return;
    try {
      await api.put('/api/game/cs2/match-presets', { name, settings: presetFieldsOf(value) });
      showSuccess(t('tournament.matchSettings.presetSaved', { name }));
      setSaving(null);
      load();
    } catch (err) {
      showError(apiErrorMessage(err, t('tournament.matchSettings.presetFailed')));
    }
  };
  const remove = async (p: SavedPreset) => {
    try {
      await api.delete(`/api/game/cs2/match-presets/${encodeURIComponent(p.id)}`);
      load();
    } catch (err) {
      showError(apiErrorMessage(err, t('tournament.matchSettings.presetFailed')));
    }
  };
  const help = saved
    ? t('tournament.matchSettings.savedHelp', { name: saved.name })
    : t(
        value.esportsMode
          ? 'tournament.matchSettings.esportsHelp'
          : 'tournament.matchSettings.standardHelp'
      );
  return (
    <Box sx={{ display: 'grid', gap: 1 }} data-testid="tournament-preset">
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          select
          size="small"
          label={t('tournament.matchSettings.preset')}
          value={selected}
          disabled={disabled}
          onChange={(e) => pick(e.target.value)}
          sx={{ minWidth: 280 }}
          slotProps={{ htmlInput: { 'data-testid': 'tournament-preset-select' } }}
        >
          <ListSubheader>{t('tournament.matchSettings.builtIn')}</ListSubheader>
          <MenuItem value="standard">{t('tournament.matchSettings.standard')}</MenuItem>
          <MenuItem value="esports">{t('tournament.matchSettings.esports')}</MenuItem>
          {presets.length > 0 && (
            <ListSubheader>{t('tournament.matchSettings.saved')}</ListSubheader>
          )}
          {presets.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
            </MenuItem>
          ))}
        </TextField>
        <Button
          variant="outlined"
          color="inherit"
          disabled={disabled}
          onClick={() => setSaving(saved?.name ?? '')}
          data-testid="tournament-save-preset"
        >
          {t('tournament.matchSettings.savePreset')}
        </Button>
        {saved && (
          <Button color="inherit" disabled={disabled} onClick={() => void remove(saved)}>
            {t('tournament.matchSettings.removePreset')}
          </Button>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary">
        {help}
      </Typography>
      {changedCount > 0 && (
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}
          data-testid="tournament-changed"
        >
          <Typography variant="body2" color="primary.main" fontWeight={600}>
            {t('tournament.matchSettings.changed', { count: changedCount })}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            disabled={disabled}
            onClick={onResetAll}
          >
            {t('tournament.matchSettings.resetAll')}
          </Button>
        </Box>
      )}
      <Dialog open={saving !== null} onClose={() => setSaving(null)} fullWidth maxWidth="xs">
        <DialogTitle>{t('tournament.matchSettings.saveTitle')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label={t('tournament.matchSettings.saveName')}
            helperText={t('tournament.matchSettings.saveNameHelp')}
            value={saving ?? ''}
            onChange={(e) => setSaving(e.target.value.slice(0, 40))}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            slotProps={{ htmlInput: { 'data-testid': 'tournament-preset-name' } }}
          />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setSaving(null)}>
            {t('tournament.matchSettings.cancel')}
          </Button>
          <Button variant="contained" disabled={!(saving ?? '').trim()} onClick={() => void save()}>
            {t('tournament.matchSettings.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/** The GOTV choices the site's Spectators settings offer too; '' is the site's own. */
const DELAY_OPTIONS = [0, 30, 105, 120];
const SEAT_OPTIONS = [8, 16, 32, 50, 100];

const INSECURE_INPUT = { 'data-testid': 'tournament-broadcast-insecure' };

/** This tournament's GOTV: delay, seats and observer HUD tools (a field left out is the site's). */
export function BroadcastFields({
  value,
  update,
  disabled,
}: {
  value: Cs2TournamentSettings;
  update: Update;
  disabled: boolean;
}) {
  const { t } = useModuleTranslation('cs2');
  const broadcast = value.broadcast ?? {};
  const updateBroadcast = (patch: Partial<NonNullable<Cs2TournamentSettings['broadcast']>>) => {
    const next = { ...broadcast, ...patch };
    for (const key of Object.keys(next) as Array<keyof typeof next>) {
      if (next[key] === undefined) delete next[key];
    }
    update({ broadcast: next });
  };
  // A value set through the API that the list does not offer is listed too.
  const withCurrent = (options: number[], current: number | undefined) =>
    current === undefined || options.includes(current)
      ? options
      : [...options, current].sort((a, b) => a - b);
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }} data-testid="tournament-broadcast">
      <Typography component="span" variant="body2" fontWeight={600}>
        {t('tournament.broadcast.title')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label={t('tournament.broadcast.delay')}
          value={broadcast.delay ?? ''}
          disabled={disabled}
          onChange={(e) =>
            updateBroadcast({ delay: e.target.value === '' ? undefined : Number(e.target.value) })
          }
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          sx={{ minWidth: 200 }}
          data-testid="tournament-broadcast-delay"
        >
          <MenuItem value="">{t('tournament.broadcast.siteDefault')}</MenuItem>
          {withCurrent(DELAY_OPTIONS, broadcast.delay).map((o) => (
            <MenuItem key={o} value={o}>
              {DELAY_OPTIONS.includes(o)
                ? t('settings.gotv.gotvDelay.option', { context: String(o) })
                : `${o} s`}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label={t('tournament.broadcast.seats')}
          value={broadcast.seats ?? ''}
          disabled={disabled}
          onChange={(e) =>
            updateBroadcast({ seats: e.target.value === '' ? undefined : Number(e.target.value) })
          }
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          sx={{ minWidth: 200 }}
          data-testid="tournament-broadcast-seats"
        >
          <MenuItem value="">{t('tournament.broadcast.siteDefault')}</MenuItem>
          {withCurrent(SEAT_OPTIONS, broadcast.seats).map((o) => (
            <MenuItem key={o} value={o}>
              {t('settings.gotv.gotvSeats.option', { count: o })}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      {(broadcast.seats ?? 0) > 30 && (
        <Typography variant="body2" color="text.secondary">
          {t('tournament.broadcast.manyViewersHint')}
        </Typography>
      )}
      {broadcast.delay === 0 && (
        <Typography variant="body2" color="warning.main">
          {t('tournament.broadcast.noDelayWarning')}
        </Typography>
      )}
      <SwitchRow
        label={t('tournament.broadcast.insecureObservers')}
        help={t('tournament.broadcast.insecureObserversHelp')}
        checked={broadcast.insecureObservers === true}
        disabled={disabled}
        onChange={(_e, checked) => updateBroadcast({ insecureObservers: checked || undefined })}
        slotProps={{ input: INSECURE_INPUT }}
      />
    </Box>
  );
}
