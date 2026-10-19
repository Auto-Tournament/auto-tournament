import { Box, MenuItem, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { SegmentedControl } from './SegmentedControl';
import { TeamLogo } from '../ui/draftUi';
import { radii, tokens } from '../../../theme/tokens';
import type { Team } from '../../../types';
import { FormField } from '../../common/ui';
import type { Untrusted } from '../../../utils/untrusted';

const { color } = tokens;

/** Groups, then playoffs: the settings the format step edits (`tournament.settings`). */
export interface GroupsForm {
  groupCount: number;
  advancePerGroup: number;
  groupSeeding: 'snake' | 'random';
  playoffType: 'single_elimination' | 'double_elimination';
  playoffFormat: 'bo1' | 'bo3' | 'bo5';
}

export const DEFAULT_GROUPS: GroupsForm = {
  groupCount: 2,
  advancePerGroup: 1,
  groupSeeding: 'snake',
  playoffType: 'single_elimination',
  playoffFormat: 'bo3',
};

export function groupsFormOf(settings: Untrusted): GroupsForm {
  const s = (settings ?? {}) as Partial<GroupsForm>;
  return {
    groupCount: [2, 3, 4].includes(Number(s.groupCount)) ? Number(s.groupCount) : 2,
    advancePerGroup: Number(s.advancePerGroup) === 2 ? 2 : 1,
    groupSeeding: s.groupSeeding === 'random' ? 'random' : 'snake',
    playoffType:
      s.playoffType === 'double_elimination' ? 'double_elimination' : 'single_elimination',
    playoffFormat: s.playoffFormat === 'bo1' || s.playoffFormat === 'bo5' ? s.playoffFormat : 'bo3',
  };
}

/** Snake: 1 A, 2 B, 3 B, 4 A … (the API draws the same at start). */
function snake<T>(items: T[], groups: number): T[][] {
  const out: T[][] = Array.from({ length: groups }, () => []);
  items.forEach((item, i) => {
    const lap = Math.floor(i / groups);
    const pos = i % groups;
    out[lap % 2 === 0 ? pos : groups - 1 - pos].push(item);
  });
  return out;
}

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * The format step's part for Groups, then playoffs (the 3.0 draft's
 * GroupStage board): how many groups, who goes through, how teams are put
 * in groups, and the playoffs; then what players get and the groups as drawn.
 */
export function GroupsFields({
  value,
  onChange,
  teamCount,
  teams,
  disabled,
}: {
  value: GroupsForm;
  onChange: (next: GroupsForm) => void;
  teamCount: number;
  /** The picked teams in seed order, for the groups preview. */
  teams: Team[];
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<GroupsForm>) => onChange({ ...value, ...patch });
  const perGroup = Math.ceil(teamCount / value.groupCount);
  const groupMatches = Array.from({ length: value.groupCount }, (_, g) => {
    const k = Math.floor(teamCount / value.groupCount) + (g < teamCount % value.groupCount ? 1 : 0);
    return (k * (k - 1)) / 2;
  }).reduce((a, b) => a + b, 0);
  let size = 2;
  while (size < value.groupCount * value.advancePerGroup) size *= 2;
  const playoffLine =
    size === 2
      ? t('tournament.setup.groups.playoffFinal', {
          format: value.playoffFormat.replace(/^bo/, 'Bo'),
        })
      : t(`tournament.setup.groups.playoff.${value.playoffType}`, { count: size });
  const preview = teams.length >= value.groupCount * 2 ? snake(teams, value.groupCount) : null;

  return (
    <Box data-testid="setup-groups" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <FormField
        layout="side"
        label={t('tournament.setup.groups.count')}
        htmlFor="groups-count"
        labelId="groups-count-label"
      >
        <SegmentedControl
          label={t('tournament.setup.groups.count')}
          value={String(value.groupCount)}
          onChange={(v) => set({ groupCount: Number(v) })}
          disabled={disabled}
          testId="setup-groups-count"
          options={['2', '3', '4'].map((v) => ({ value: v, label: v }))}
        />
      </FormField>
      <FormField
        layout="side"
        label={t('tournament.setup.groups.through')}
        htmlFor="groups-through"
        labelId="groups-through-label"
      >
        <SegmentedControl
          label={t('tournament.setup.groups.through')}
          value={String(value.advancePerGroup)}
          onChange={(v) => set({ advancePerGroup: Number(v) })}
          disabled={disabled}
          testId="setup-groups-through"
          options={[
            { value: '1', label: t('tournament.setup.groups.throughWinner') },
            { value: '2', label: t('tournament.setup.groups.throughTop2') },
          ]}
        />
      </FormField>
      <FormField
        layout="side"
        label={t('tournament.setup.groups.seeding')}
        htmlFor="groups-seeding"
        labelId="groups-seeding-label"
      >
        <TextField
          select
          fullWidth
          size="small"
          id="groups-seeding"
          value={value.groupSeeding}
          disabled={disabled}
          onChange={(e) => set({ groupSeeding: e.target.value as GroupsForm['groupSeeding'] })}
        >
          <MenuItem value="snake">{t('tournament.setup.groups.seedingSnake')}</MenuItem>
          <MenuItem value="random">{t('tournament.setup.groups.seedingRandom')}</MenuItem>
        </TextField>
      </FormField>
      <FormField
        layout="side"
        label={t('tournament.setup.groups.playoffs')}
        htmlFor="groups-playoffs"
        labelId="groups-playoffs-label"
      >
        <TextField
          select
          fullWidth
          size="small"
          id="groups-playoffs"
          value={value.playoffType}
          disabled={disabled}
          onChange={(e) => set({ playoffType: e.target.value as GroupsForm['playoffType'] })}
        >
          <MenuItem value="single_elimination">
            {t('tournament.setup.format.names.single_elimination')}
          </MenuItem>
          <MenuItem value="double_elimination">
            {t('tournament.setup.format.names.double_elimination')}
          </MenuItem>
        </TextField>
      </FormField>
      <FormField
        layout="side"
        label={t('tournament.setup.groups.playoffMatches')}
        htmlFor="groups-playoff-format"
        labelId="groups-playoff-format-label"
      >
        <SegmentedControl
          label={t('tournament.setup.groups.playoffMatches')}
          value={value.playoffFormat}
          onChange={(v) => set({ playoffFormat: v as GroupsForm['playoffFormat'] })}
          disabled={disabled}
          testId="setup-groups-playoff-format"
          options={['bo1', 'bo3', 'bo5'].map((v) => ({ value: v, label: v.replace(/^bo/, 'Bo') }))}
        />
      </FormField>
      <Typography variant="body2" color="text.secondary">
        {t('tournament.setup.groups.ties')}
      </Typography>

      <Box
        component="ul"
        aria-label={t('tournament.setup.groups.whatPlayersGet')}
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))',
          gap: 1.5,
        }}
      >
        {[
          [
            t('tournament.setup.groups.stage'),
            t('tournament.setup.groups.stageLine', { groups: value.groupCount, size: perGroup }),
            t('tournament.setup.groups.stageNote', {
              count: groupMatches,
              each: Math.max(0, perGroup - 1),
            }),
          ],
          [
            t('tournament.setup.groups.playoffs'),
            playoffLine,
            t('tournament.setup.groups.throughNote', { count: Math.min(size, teamCount) }),
          ],
        ].map(([eyebrow, line, note]) => (
          <Box
            key={eyebrow}
            component="li"
            sx={{
              p: 2,
              borderRadius: radii.md,
              bgcolor: color.paper3,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5,
            }}
          >
            <Typography
              sx={{
                fontSize: '0.75rem',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: color.muted,
              }}
            >
              {eyebrow}
            </Typography>
            <Typography sx={{ fontWeight: 600 }}>{line}</Typography>
            <Typography variant="body2" color="text.secondary">
              {note}
            </Typography>
          </Box>
        ))}
      </Box>

      {preview && value.groupSeeding === 'snake' && (
        <Box
          data-testid="setup-groups-preview"
          sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
        >
          <Typography variant="body2" fontWeight={600}>
            {t('tournament.setup.groups.previewTitle')}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))',
              gap: 1.5,
            }}
          >
            {preview.map((group, i) => (
              <Box
                key={LETTERS[i]}
                sx={{
                  p: 2,
                  borderRadius: radii.md,
                  bgcolor: color.paper3,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                }}
              >
                <Typography
                  sx={{
                    fontSize: '0.75rem',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: color.muted,
                  }}
                >
                  {t('tournament.setup.groups.groupN', { letter: LETTERS[i] })}
                </Typography>
                {group.map((team) => (
                  <Box key={team.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TeamLogo team={{ id: team.id, name: team.name, tag: team.tag }} size="sm" />
                    <Typography variant="body2">{team.name}</Typography>
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
          <Typography variant="body2" color="text.secondary">
            {t('tournament.setup.groups.previewNote')}
          </Typography>
        </Box>
      )}
      {value.groupSeeding === 'random' && (
        <Typography variant="body2" color="text.secondary">
          {t('tournament.setup.groups.randomNote')}
        </Typography>
      )}
    </Box>
  );
}
