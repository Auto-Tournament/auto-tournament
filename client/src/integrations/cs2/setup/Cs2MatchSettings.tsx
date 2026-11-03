import type { InputHTMLAttributes } from 'react';
import { Box, MenuItem, TextField, Typography } from '@mui/material';
import { SegmentedControl, useModuleTranslation, radii, SwitchRow } from '../../../module-sdk';
import type { TournamentRulesStepProps as Cs2MatchSettingsProps } from '../../types';
import {
  cs2Patch,
  cs2SettingsOf,
  overtimeOptionOf,
  type Cs2TournamentSettings,
  type OvertimeOption,
} from './cs2TournamentSettings';
import {
  changedFromSite,
  effectiveRules,
  presetPatch,
  presetRules,
  withPreset,
  type PresetKey,
} from './matchPresetRules';
import {
  BroadcastFields,
  PresetPicker,
  Section,
  SiteMark,
  useSiteMatchDefaults,
} from './MatchSettingsParts';
import { PrizeFields } from './PrizeFields';

/**
 * Round limit and overtime, which the Counter-Strike 2 module passes to
 * Ready Up (mp_maxrounds, overtimeMode / overtimeSegments). Same rules for
 * shuffle and bracket tournaments. They are CS2's own settings
 * (`settings.cs2`), which this step reads from and writes to the wizard's
 * settings object.
 */
/** Tactical timeouts and technical pauses offered, as "count×seconds". */
const TACTICAL = ['3x30', '3x31', '4x30', '2x30', '0'];
const TECHNICAL = ['', '0x0', '3x300', '1x120'];
/** Default agents keeps its copy from #1478; the rest are this page's. */
const switchKey = (key: string) =>
  key === 'defaultAgents' ? 'tournament.defaultAgents' : `tournament.matchSettings.${key}`;

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
  const site = useSiteMatchDefaults();
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

      <PresetPicker
        value={value}
        changedCount={changed.size}
        update={update}
        disabled={disabled}
        onResetAll={() =>
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
      />

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
        <BroadcastFields value={value} update={update} disabled={disabled} />
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
        <PrizeFields value={value} update={update} disabled={disabled} />
      </Section>
    </Box>
  );
}
