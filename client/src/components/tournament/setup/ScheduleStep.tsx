import { Box, MenuItem, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { SegmentedControl } from './SegmentedControl';
import { getRoundLabel } from '../../../utils/matchUtils';
import { radii, tokens } from '../../../theme/tokens';

const { color } = tokens;

/** Match times as the wizard edits them; saved as `settings.matchTimes` (api services/matchTimes.ts). */
export interface MatchTimesForm {
  mode: 'times' | 'asap';
  /** Round number → "12:00" on the tournament's day. */
  rounds: Record<string, string>;
  vetoLeadMinutes: number;
  reminderMinutes: number;
}

export const DEFAULT_MATCH_TIMES: MatchTimesForm = {
  mode: 'asap',
  rounds: {},
  vetoLeadMinutes: 5,
  reminderMinutes: 15,
};

function hhmmOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** A saved tournament's match times, as the form holds them. */
export function matchTimesFormOf(settings: unknown): MatchTimesForm {
  const raw = (
    (settings ?? {}) as {
      matchTimes?: Partial<{
        mode: string;
        rounds: Record<string, string>;
        vetoLeadMinutes: number;
        reminderMinutes: number;
      }>;
    }
  ).matchTimes;
  if (!raw) return DEFAULT_MATCH_TIMES;
  return {
    mode: raw.mode === 'times' ? 'times' : 'asap',
    rounds: Object.fromEntries(Object.entries(raw.rounds ?? {}).map(([r, at]) => [r, hhmmOf(at)])),
    vetoLeadMinutes: typeof raw.vetoLeadMinutes === 'number' ? raw.vetoLeadMinutes : 5,
    reminderMinutes: typeof raw.reminderMinutes === 'number' ? raw.reminderMinutes : 15,
  };
}

/** `settings.matchTimes` for saving: each "12:00" on `day` (the tournament's start, else today). */
export function matchTimesSetting(form: MatchTimesForm, startsAt: string | null | undefined) {
  const day = startsAt && Number.isFinite(Date.parse(startsAt)) ? new Date(startsAt) : new Date();
  const rounds: Record<string, string> = {};
  for (const [round, hhmm] of Object.entries(form.rounds)) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
    if (!m) continue;
    const at = new Date(day);
    at.setHours(Number(m[1]), Number(m[2]), 0, 0);
    rounds[round] = at.toISOString();
  }
  return {
    mode: form.mode,
    rounds,
    vetoLeadMinutes: form.vetoLeadMinutes,
    reminderMinutes: form.reminderMinutes,
  };
}

/**
 * The wizard's "When matches start" (the 3.0 draft's Schedule step): at set
 * times, a start time per round, the veto opening before it and a reminder;
 * or as soon as ready. One match's own time is set in Manage › Schedule once
 * the bracket exists.
 */
export function ScheduleStep({
  value,
  onChange,
  rounds,
  elimination,
  breakMinutes,
  disabled,
}: {
  value: MatchTimesForm;
  onChange: (next: MatchTimesForm) => void;
  /** How many rounds the format will have (estimated before the bracket exists). */
  rounds: number;
  elimination: boolean;
  /** The site's break between a team's matches (CS2 match rules), when known. */
  breakMinutes: number | null;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<MatchTimesForm>) => onChange({ ...value, ...patch });
  const roundName = (n: number) =>
    elimination ? getRoundLabel(n, rounds) : t('schedulePage.roundN', { n });
  const row = {
    display: 'grid',
    gridTemplateColumns: { xs: 'minmax(0, 1fr) 130px', sm: 'minmax(0, 1fr) 150px 140px' },
    gap: 1.5,
    alignItems: 'center',
    px: 2,
    py: 1.25,
    borderRadius: radii.md,
    bgcolor: color.paper3,
  } as const;

  return (
    <Box data-testid="setup-schedule" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <SegmentedControl
        label={t('schedulePage.modeLabel')}
        value={value.mode}
        onChange={(mode) => set({ mode })}
        disabled={disabled}
        testId="setup-schedule-mode"
        options={[
          { value: 'times', label: t('schedulePage.modeTimes') },
          { value: 'asap', label: t('schedulePage.modeAsap') },
        ]}
      />
      <Typography variant="body2" color="text.secondary">
        {value.mode === 'times'
          ? t('tournament.setup.schedule.timesNote')
          : t('schedulePage.modeAsapNote')}
      </Typography>
      {value.mode === 'times' && (
        <>
          <Box
            component="ol"
            sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }}
          >
            {Array.from({ length: rounds }, (_, i) => i + 1).map((n) => (
              <Box key={n} component="li" sx={row}>
                <Typography sx={{ fontWeight: 600 }}>{roundName(n)}</Typography>
                <Typography
                  component="label"
                  htmlFor={`setup-round-${n}`}
                  sx={{
                    display: { xs: 'none', sm: 'block' },
                    textAlign: 'right',
                    fontSize: '0.875rem',
                    color: color.ink2,
                  }}
                >
                  {t('schedulePage.roundStartsAt')}
                </Typography>
                <TextField
                  id={`setup-round-${n}`}
                  type="time"
                  size="small"
                  value={value.rounds[String(n)] ?? ''}
                  disabled={disabled}
                  onChange={(e) =>
                    set({ rounds: { ...value.rounds, [String(n)]: e.target.value } })
                  }
                  slotProps={{
                    htmlInput: {
                      'aria-label': t('schedulePage.roundTimeLabel', { round: roundName(n) }),
                      'data-testid': `setup-round-${n}-time`,
                    },
                  }}
                />
              </Box>
            ))}
          </Box>
          {(
            [
              ['veto', 'vetoLeadMinutes', [5, 10, 0]],
              ['reminder', 'reminderMinutes', [15, 30, 0]],
            ] as const
          ).map(([key, field, options]) => (
            <Box key={key} sx={row}>
              <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600 }}>{t(`schedulePage.${key}Title`)}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t(`schedulePage.${key}Note`)}
                </Typography>
              </Box>
              <Typography
                component="label"
                htmlFor={`setup-${key}`}
                sx={{
                  display: { xs: 'none', sm: 'block' },
                  textAlign: 'right',
                  fontSize: '0.875rem',
                  color: color.ink2,
                }}
              >
                {t(`schedulePage.${key}Label`)}
              </Typography>
              <TextField
                select
                size="small"
                id={`setup-${key}`}
                value={value[field]}
                disabled={disabled}
                onChange={(e) =>
                  set({ [field]: Number(e.target.value) } as Partial<MatchTimesForm>)
                }
              >
                {options.map((n) => (
                  <MenuItem key={n} value={n}>
                    {n === 0
                      ? t(`schedulePage.${key}Zero`)
                      : t('schedulePage.minutesBefore', { count: n })}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
          ))}
          <Typography variant="body2" color="text.secondary">
            {[
              breakMinutes !== null
                ? breakMinutes > 0
                  ? t('tournament.setup.schedule.breakNote', { count: breakMinutes })
                  : t('tournament.setup.schedule.noBreakNote')
                : null,
              t('tournament.setup.schedule.ownTimeNote'),
            ]
              .filter(Boolean)
              .join(' ')}
          </Typography>
        </>
      )}
    </Box>
  );
}
