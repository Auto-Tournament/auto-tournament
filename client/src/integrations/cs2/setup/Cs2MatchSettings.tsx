import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Box, Button, MenuItem, TextField, Typography } from '@mui/material';
import { api, SegmentedControl, useModuleTranslation, radii, SwitchRow } from '../../../module-sdk';
import type { TournamentRulesStepProps as Cs2MatchSettingsProps } from '../../types';
import {
  changedFromSite,
  cs2Patch,
  cs2SettingsOf,
  effectiveRules,
  overtimeOptionOf,
  presetPatch,
  presetRules,
  withPreset,
  type PresetKey,
  type SiteMatchDefaults,
  type Cs2TournamentSettings,
  type OvertimeOption,
} from './cs2TournamentSettings';

/**
 * Round limit and overtime, which the Counter-Strike 2 module passes to
 * Ready Up (mp_maxrounds, overtimeMode / overtimeSegments). Same rules for
 * shuffle and bracket tournaments. They are CS2's own settings
 * (`settings.cs2`), which this step reads from and writes to the wizard's
 * settings object.
 */
/** Places with a prize: 1st–4th, and 0 for everyone else who played. */
const PRIZE_PLACES = [1, 2, 3, 4, 0];
/** The GOTV choices the site's Spectators settings offer too; '' is the site's own. */
const DELAY_OPTIONS = [0, 30, 105, 120];
const SEAT_OPTIONS = [8, 16, 32, 50, 100];

/** Tactical timeouts and technical pauses offered, as "count×seconds". */
const TACTICAL = ['3x30', '3x31', '4x30', '2x30', '0'];
const TECHNICAL = ['', '0x0', '3x300', '1x120'];
/** Until the site's settings load (or for someone who can't read them): Ready Up's defaults. */
const SITE_FALLBACK: SiteMatchDefaults = {
  teamReady: true,
  giveUpVote: false,
  autoStartMinutes: 0,
};

/** "Site: 5 min · Reset" under a setting that differs from the site's defaults. */
function SiteMark({
  site,
  onReset,
  resetLabel,
}: {
  site: string;
  onReset: () => void;
  resetLabel: string;
}) {
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
        {resetLabel}
      </Button>
    </Box>
  );
}

function Section({ title, help, children }: { title: string; help: string; children: ReactNode }) {
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

/** Default agents keeps its copy from #1478; the rest are this page's. */
const switchKey = (key: string) =>
  key === 'defaultAgents' ? 'tournament.defaultAgents' : `tournament.matchSettings.${key}`;

const PRIZE_RARITIES = ['ancient', 'legendary', 'mythical', 'rare', 'uncommon', 'common'];
/** A custom list starts from the best: 1st the rarest grade with skins, one lower each place. */
const DEFAULT_PRIZES: NonNullable<Cs2TournamentSettings['rewards']> = [
  { place: 1, mode: 'random', rarity: 'ancient' },
  { place: 2, mode: 'random', rarity: 'legendary' },
  { place: 3, mode: 'random', rarity: 'mythical' },
  { place: 4, mode: 'random', rarity: 'rare' },
  { place: 0, mode: 'random', rarity: 'uncommon' },
];

export function Cs2MatchSettings({
  settings,
  onChange,
  type,
  disabled = false,
}: Cs2MatchSettingsProps) {
  const { t } = useModuleTranslation('cs2');
  const value = cs2SettingsOf(settings);
  const overtimeOption = overtimeOptionOf(value);
  const { maxRounds, overtimeSegments } = value;
  // The test ids the wizard has always had for each kind of tournament.
  const maxRoundsTestId =
    type === 'shuffle' ? 'shuffle-max-rounds-field' : 'tournament-max-rounds-field';
  const update = (patch: Partial<Cs2TournamentSettings>) =>
    onChange(cs2Patch({ ...value, ...patch }));
  // The site's Match rules, which the orange marks compare with.
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
  const rules = effectiveRules(value, site);
  const standard = presetRules(false, site);
  const changed = new Set<string>(changedFromSite(value, site));
  if (value.fillTeamsWithBots === true) changed.add('botFill');
  if ((value.connectVia ?? 'auto') !== 'auto') changed.add('connectVia');
  if (maxRounds !== 24) changed.add('maxRounds');
  if (overtimeOption !== 'enabled') changed.add('overtime');
  const setRule = (key: PresetKey, v: boolean | number | string) =>
    update(presetPatch(value, site, key, v));
  const choiceLabel = (key: 'tactical' | 'technical', v: string) => {
    if (v === '') return t('tournament.matchSettings.serverDefault');
    const [count, seconds] = v.split('x').map(Number);
    if (count === 0) return t(`tournament.matchSettings.${key}None`);
    return t('tournament.matchSettings.countTimes', { count, seconds });
  };
  const siteLabel = (
    key: PresetKey | 'botFill' | 'connectVia' | 'maxRounds' | 'overtime'
  ): string => {
    const on = t('tournament.matchSettings.on'),
      off = t('tournament.matchSettings.off');
    switch (key) {
      case 'botFill':
        return off;
      case 'connectVia':
        return t('tournament.connectVia.auto');
      case 'maxRounds':
        return '24';
      case 'overtime':
        return t('tournament.setup.format.overtime.enabled');
      case 'tactical':
      case 'technical':
        return choiceLabel(key, standard[key]);
      case 'autoStartMinutes':
        return standard.autoStartMinutes === 0
          ? t('tournament.matchSettings.never')
          : t('tournament.matchSettings.minutes', { count: standard.autoStartMinutes });
      default:
        return standard[key] ? on : off;
    }
  };
  const mark = (key: Parameters<typeof siteLabel>[0], reset: () => void) =>
    changed.has(key) ? (
      <SiteMark
        site={t('tournament.matchSettings.site', { value: siteLabel(key) })}
        onReset={reset}
        resetLabel={t('tournament.matchSettings.reset')}
      />
    ) : null;
  const ruleSwitch = (
    key: 'knifeRound' | 'teamReady' | 'giveUpVote' | 'platformSkins' | 'defaultAgents',
    testId: string
  ) => (
    <Box>
      <SwitchRow
        label={t(`${switchKey(key)}.label`)}
        help={t(`${switchKey(key)}.help`)}
        checked={rules[key]}
        disabled={disabled}
        onChange={(_e, checked) => setRule(key, checked)}
        slotProps={{ input: { 'data-testid': testId } as InputHTMLAttributes<HTMLInputElement> }}
      />
      {mark(key, () => setRule(key, standard[key]))}
    </Box>
  );
  const ruleSelect = (key: 'tactical' | 'technical', options: string[], testId: string) => (
    <Box>
      <TextField
        select
        size="small"
        label={t(`tournament.matchSettings.${key}.label`)}
        helperText={t(`tournament.matchSettings.${key}.help`)}
        value={rules[key]}
        disabled={disabled}
        onChange={(e) => setRule(key, e.target.value)}
        slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        sx={{ maxWidth: 360, width: '100%' }}
        data-testid={testId}
      >
        {(options.includes(rules[key]) ? options : [...options, rules[key]])
          .filter((o) => o !== '' || !value.esportsMode)
          .map((o) => (
            <MenuItem key={o} value={o}>
              {choiceLabel(key, o)}
            </MenuItem>
          ))}
      </TextField>
      {mark(key, () => setRule(key, standard[key]))}
    </Box>
  );
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

  const handleOvertimeOption = (option: OvertimeOption) => {
    if (option === 'enabled') {
      // 0 segments only means something together with "disabled".
      update({
        overtimeMode: 'enabled',
        overtimeSegments: overtimeSegments === 0 ? null : overtimeSegments,
      });
      return;
    }
    update({
      overtimeMode: 'disabled',
      overtimeSegments: option === 'disabledNoDraws' ? 0 : null,
    });
  };

  return (
    <Box
      component="fieldset"
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: radii.md,
        p: 2.5,
        m: 0,
        minWidth: 0,
        display: 'grid',
        gap: 3,
      }}
    >
      <Box component="legend" sx={{ px: 1 }}>
        <Typography component="span" fontWeight={600}>
          {t('tournament.setup.format.cs2Title')}
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: -2 }}>
        {t('tournament.setup.format.cs2Help')}
      </Typography>

      <Box sx={{ display: 'grid', gap: 1 }} data-testid="tournament-preset">
        <Typography component="span" variant="body2" fontWeight={600}>
          {t('tournament.matchSettings.preset')}
        </Typography>
        <SegmentedControl<'standard' | 'esports'>
          label={t('tournament.matchSettings.preset')}
          value={value.esportsMode ? 'esports' : 'standard'}
          onChange={(v) => update(withPreset(v === 'esports'))}
          disabled={disabled}
          testId="tournament-esports-mode"
          options={[
            { value: 'standard', label: t('tournament.matchSettings.standard') },
            { value: 'esports', label: t('tournament.matchSettings.esports') },
          ]}
        />
        <Typography variant="body2" color="text.secondary">
          {t(
            value.esportsMode
              ? 'tournament.matchSettings.esportsHelp'
              : 'tournament.matchSettings.standardHelp'
          )}
        </Typography>
        {changed.size > 0 && (
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}
            data-testid="tournament-changed"
          >
            <Typography variant="body2" color="primary.main" fontWeight={600}>
              {t('tournament.matchSettings.changed', { count: changed.size })}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              disabled={disabled}
              onClick={() =>
                update({
                  ...withPreset(false),
                  teamReady: null,
                  giveUpVote: null,
                  autoStartMinutes: null,
                  fillTeamsWithBots: false,
                  connectVia: 'auto',
                  maxRounds: 24,
                  overtimeMode: 'enabled',
                  overtimeSegments: null,
                })
              }
            >
              {t('tournament.matchSettings.resetAll')}
            </Button>
          </Box>
        )}
      </Box>

      <Section
        title={t('tournament.matchSettings.rounds')}
        help={t('tournament.matchSettings.roundsHelp')}
      >
        <TextField
          label={t('tournament.wizard.maxRoundsLabel')}
          type="number"
          value={maxRounds === 0 ? '' : maxRounds}
          onChange={(event) => {
            const parsed = parseInt(event.target.value, 10);
            update({ maxRounds: Number.isNaN(parsed) ? 0 : parsed });
          }}
          disabled={disabled}
          slotProps={{ htmlInput: { min: 1, max: 30, 'data-testid': maxRoundsTestId } }}
          helperText={
            maxRounds > 0
              ? t('tournament.wizard.maxRoundsHelper', {
                  maxRounds,
                  winRounds: Math.floor(maxRounds / 2) + 1,
                })
              : t('tournament.wizard.maxRoundsHelperEmpty')
          }
          error={maxRounds < 1 || maxRounds > 30}
          sx={{ maxWidth: 360 }}
        />
        {mark('maxRounds', () => update({ maxRounds: 24 }))}

        <Box sx={{ display: 'grid', gap: 1 }}>
          <Typography component="span" variant="body2" fontWeight={600}>
            {t('tournament.overtime.selectLabel')}
          </Typography>
          <SegmentedControl<OvertimeOption>
            label={t('tournament.overtime.selectLabel')}
            value={overtimeOption}
            onChange={handleOvertimeOption}
            disabled={disabled}
            testId="tournament-overtime-mode"
            options={[
              { value: 'enabled', label: t('tournament.setup.format.overtime.enabled') },
              {
                value: 'disabledDraws',
                label: t('tournament.setup.format.overtime.disabledDraws'),
              },
              {
                value: 'disabledNoDraws',
                label: t('tournament.setup.format.overtime.disabledNoDraws'),
              },
            ]}
          />
          <Typography variant="body2" color="text.secondary">
            {t('tournament.overtime.modeHelper')}
          </Typography>
          {mark('overtime', () => handleOvertimeOption('enabled'))}
        </Box>

        {overtimeOption === 'enabled' && (
          <TextField
            label={t('tournament.overtime.segmentsLabel')}
            type="number"
            value={typeof overtimeSegments === 'number' ? overtimeSegments : ''}
            onChange={(event) => {
              const raw = event.target.value.trim();
              const parsed = Number(raw);
              update({
                overtimeSegments:
                  raw === '' || !Number.isFinite(parsed) || parsed < 0 ? null : parsed,
              });
            }}
            disabled={disabled}
            slotProps={{ htmlInput: { min: 0, max: 10 } }}
            helperText={
              typeof overtimeSegments === 'number' && overtimeSegments > 0
                ? t('tournament.overtime.segmentsHelperValue', { count: overtimeSegments })
                : t('tournament.overtime.segmentsHelper')
            }
            sx={{ maxWidth: 360 }}
          />
        )}
        {ruleSwitch('knifeRound', 'tournament-knife-round')}
      </Section>

      <Section
        title={t('tournament.matchSettings.ready')}
        help={t('tournament.matchSettings.readyHelp')}
      >
        {ruleSwitch('teamReady', 'tournament-team-ready')}
        <Box>
          <TextField
            size="small"
            type="number"
            label={t('tournament.autoStart.label')}
            helperText={t('tournament.autoStart.help')}
            value={value.autoStartMinutes ?? ''}
            disabled={disabled}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              update({ autoStartMinutes: Number.isNaN(n) ? null : Math.min(120, Math.max(0, n)) });
            }}
            slotProps={{ htmlInput: { min: 0, max: 120, 'data-testid': 'tournament-auto-start' } }}
            sx={{ maxWidth: 360 }}
          />
          {mark('autoStartMinutes', () => update({ autoStartMinutes: null }))}
        </Box>
        <Box>
          <SwitchRow
            label={t('tournament.botFill.label')}
            help={t('tournament.botFill.help')}
            checked={value.fillTeamsWithBots === true}
            disabled={disabled}
            onChange={(_e, checked) => update({ fillTeamsWithBots: checked })}
            slotProps={{
              input: {
                'data-testid': 'tournament-bot-fill',
              } as InputHTMLAttributes<HTMLInputElement>,
            }}
          />
          {mark('botFill', () => update({ fillTeamsWithBots: false }))}
        </Box>
      </Section>

      <Section
        title={t('tournament.matchSettings.pauses')}
        help={t('tournament.matchSettings.pausesHelp')}
      >
        {ruleSelect('tactical', TACTICAL, 'tournament-tactical')}
        {ruleSelect('technical', TECHNICAL, 'tournament-technical')}
        {ruleSwitch('giveUpVote', 'tournament-give-up')}
      </Section>

      <Section
        title={t('tournament.matchSettings.looks')}
        help={t('tournament.matchSettings.looksHelp')}
      >
        {ruleSwitch('platformSkins', 'tournament-platform-skins')}
        {ruleSwitch('defaultAgents', 'tournament-default-agents')}
      </Section>

      <Section
        title={t('tournament.matchSettings.connecting')}
        help={t('tournament.matchSettings.connectingHelp')}
      >
        <Box>
          <TextField
            select
            size="small"
            id="tournament-connect-via"
            label={t('tournament.connectVia.label')}
            helperText={t('tournament.connectVia.help')}
            value={value.connectVia ?? 'auto'}
            disabled={disabled}
            onChange={(e) => update({ connectVia: e.target.value as 'auto' | 'lan' | 'public' })}
            sx={{ maxWidth: 360 }}
          >
            <MenuItem value="auto">{t('tournament.connectVia.auto')}</MenuItem>
            <MenuItem value="lan">{t('tournament.connectVia.lan')}</MenuItem>
            <MenuItem value="public">{t('tournament.connectVia.public')}</MenuItem>
          </TextField>
          {mark('connectVia', () => update({ connectVia: 'auto' }))}
        </Box>
      </Section>

      <Section
        title={t('tournament.matchSettings.spectators')}
        help={t('tournament.matchSettings.spectatorsHelp')}
      >
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
                updateBroadcast({
                  delay: e.target.value === '' ? undefined : Number(e.target.value),
                })
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
                updateBroadcast({
                  seats: e.target.value === '' ? undefined : Number(e.target.value),
                })
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
            slotProps={{
              input: {
                'data-testid': 'tournament-broadcast-insecure',
              } as InputHTMLAttributes<HTMLInputElement>,
            }}
          />
        </Box>
      </Section>

      <Section
        title={t('tournament.matchSettings.after')}
        help={t('tournament.matchSettings.afterHelp')}
      >
        <SwitchRow
          label={t('highlights.recordSwitch')}
          help={t('highlights.recordSwitchHelp')}
          checked={value.highlights !== false}
          onChange={(event) => update({ highlights: event.target.checked })}
          disabled={disabled}
          data-testid="tournament-highlights"
        />
        <SwitchRow
          label={t('skins.tournamentRewardsSwitch')}
          checked={value.skinRewards !== false}
          onChange={(event) => update({ skinRewards: event.target.checked })}
          disabled={disabled}
        />
        {value.skinRewards !== false && (
          <Box
            sx={{ display: 'grid', gap: 1.5, maxWidth: 520 }}
            data-testid="tournament-prizes-editor"
          >
            <SegmentedControl
              label={t('skins.prizesEditor.label')}
              value={value.rewards ? 'custom' : 'site'}
              onChange={(v: string) => update({ rewards: v === 'custom' ? DEFAULT_PRIZES : null })}
              options={[
                { value: 'site', label: t('skins.prizesEditor.site') },
                { value: 'custom', label: t('skins.prizesEditor.custom') },
              ]}
              disabled={disabled}
            />
            {value.rewards &&
              PRIZE_PLACES.map((place) => {
                const r = value.rewards?.find((x) => x.place === place);
                const current = !r || r.mode === 'none' ? 'none' : (r.rarity ?? 'rare');
                return (
                  <TextField
                    key={place}
                    select
                    size="small"
                    label={
                      place === 0 ? t('skins.prizes.everyone') : t('skins.place', { n: place })
                    }
                    value={current}
                    disabled={disabled}
                    data-testid={`tournament-prize-place-${place}`}
                    onChange={(e) => {
                      const next = (value.rewards ?? []).filter((x) => x.place !== place);
                      next.push(
                        e.target.value === 'none'
                          ? { place, mode: 'none' }
                          : { place, mode: 'random', rarity: e.target.value }
                      );
                      update({ rewards: next.sort((a, b) => (a.place || 9) - (b.place || 9)) });
                    }}
                  >
                    {PRIZE_RARITIES.map((rarity) => (
                      <MenuItem key={rarity} value={rarity}>
                        {t('skins.prizes.pickOne', { rarity: t(`skins.rarity.${rarity}`) })}
                      </MenuItem>
                    ))}
                    <MenuItem value="none">{t('skins.admin.noReward')}</MenuItem>
                  </TextField>
                );
              })}
          </Box>
        )}
      </Section>
    </Box>
  );
}
