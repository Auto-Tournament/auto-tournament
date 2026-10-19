import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api, apiErrorMessage } from '../utils/api';
import { useSnackbar } from '../contexts/SnackbarContext';
import { PageHead } from '../components/common/ui';
import { SegmentedControl } from '../components/tournament/setup/SegmentedControl';
import { TeamLogo, panel } from '../components/tournament/ui/draftUi';
import { getRoundLabel } from '../utils/matchUtils';
import { pageTitle } from '../utils/pageTitle';
import { fontDisplay, radii, tokens } from '../theme/tokens';
import type { Untrusted } from '../utils/untrusted';

const { color } = tokens;

interface ScheduleTournament {
  id: number;
  name: string;
  type: string;
  status: string;
  settings?: Record<string, Untrusted>;
}
interface ScheduleMatch {
  slug: string;
  round: number;
  matchNumber: number;
  team1?: { id: string; name: string; tag?: string } | null;
  team2?: { id: string; name: string; tag?: string } | null;
  status: string;
  ownStartsAt?: number | null;
}
interface MatchTimes {
  mode: 'times' | 'asap';
  rounds: Record<string, string>;
  vetoLeadMinutes: number;
  reminderMinutes: number;
}

/** "12:00" for an ISO time or unix seconds, in this browser's time. */
function hhmmOf(at: string | number | null | undefined): string {
  if (at === null || at === undefined || at === '') return '';
  const d = typeof at === 'number' ? new Date(at * 1000) : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "12:00" on `day` → ISO; '' → null. */
function isoOn(day: Date, hhmm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const d = new Date(day);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.toISOString();
}

/** One row's grid: what, a fixed-width label, the field, an action (the draft's columns). */
const ROW = {
  display: 'grid',
  gridTemplateColumns: { xs: 'minmax(0, 1fr) 120px', md: 'minmax(0, 1fr) 150px 120px 150px' },
  gap: 1.5,
  alignItems: 'center',
} as const;

function RowLabel({
  htmlFor,
  children,
  color: tone = color.ink2,
  bold = false,
}: {
  htmlFor: string;
  children: ReactNode;
  color?: string;
  bold?: boolean;
}) {
  return (
    <Typography
      component="label"
      htmlFor={htmlFor}
      sx={{
        display: { xs: 'none', md: 'block' },
        textAlign: 'right',
        fontSize: '0.875rem',
        color: tone,
        fontWeight: bold ? 600 : 400,
      }}
    >
      {children}
    </Typography>
  );
}

/**
 * Manage › one tournament › Schedule (the 3.0 draft's Match times board): a
 * start time per round, or one match's own, the veto opening before it and a
 * reminder, in `settings.matchTimes` (api services/matchTimes.ts). "As soon
 * as ready" keeps today's behaviour: a match goes ahead once both teams and a
 * server are ready.
 */
export default function TournamentSchedule() {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [tournament, setTournament] = useState<ScheduleTournament | null>(null);
  const [matches, setMatches] = useState<ScheduleMatch[]>([]);
  const [totalRounds, setTotalRounds] = useState(0);
  const [failed, setFailed] = useState(false);
  const [times, setTimes] = useState<MatchTimes | null>(null);
  // Per round "12:00", and per match its own "12:30" ('' = the round's).
  const [roundTimes, setRoundTimes] = useState<Record<string, string>>({});
  const [ownTimes, setOwnTimes] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = pageTitle(t('schedulePage.title'));
  }, [t]);

  useEffect(() => {
    let live = true;
    Promise.all([
      api.get<{ tournament: ScheduleTournament }>('/api/tournament'),
      api
        .get<{ matches?: ScheduleMatch[]; totalRounds?: number }>('/api/tournament/bracket')
        .catch(() => ({ matches: [], totalRounds: 0 })),
    ])
      .then(([tr, br]) => {
        if (!live) return;
        setTournament(tr.tournament);
        setMatches(br.matches ?? []);
        setTotalRounds(br.totalRounds ?? 0);
        const raw = (tr.tournament.settings?.matchTimes ?? {}) as Partial<MatchTimes>;
        const next: MatchTimes = {
          mode: raw.mode === 'times' ? 'times' : 'asap',
          rounds: raw.rounds ?? {},
          vetoLeadMinutes: typeof raw.vetoLeadMinutes === 'number' ? raw.vetoLeadMinutes : 5,
          reminderMinutes: typeof raw.reminderMinutes === 'number' ? raw.reminderMinutes : 15,
        };
        setTimes(next);
        setRoundTimes(
          Object.fromEntries(Object.entries(next.rounds).map(([r, at]) => [r, hhmmOf(at)]))
        );
        setOwnTimes(
          Object.fromEntries(
            (br.matches ?? [])
              .filter((m) => m.ownStartsAt)
              .map((m) => [m.slug, hhmmOf(m.ownStartsAt)])
          )
        );
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  // The day the times are on: the tournament's start day, else today.
  const day = useMemo(() => {
    const startsAt = tournament?.settings?.startsAt;
    const d =
      typeof startsAt === 'string' && Number.isFinite(Date.parse(startsAt))
        ? new Date(startsAt)
        : new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, [tournament]);

  const rounds = useMemo(() => {
    const max = Math.max(totalRounds, ...matches.map((m) => m.round ?? 0));
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [matches, totalRounds]);

  if (failed) return <Alert severity="error">{t('schedulePage.loadFailed')}</Alert>;
  if (!tournament || !times) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const elimination = /elimination/.test(tournament.type);
  const roundName = (round: number) =>
    elimination ? getRoundLabel(round, rounds.length) : t('schedulePage.roundN', { n: round });

  const save = async () => {
    setSaving(true);
    try {
      const roundsIso = Object.fromEntries(
        Object.entries(roundTimes)
          .map(([r, v]) => [r, isoOn(day, v)] as const)
          .filter((e): e is readonly [string, string] => Boolean(e[1]))
      );
      await api.put('/api/tournament', {
        settings: { matchTimes: { ...times, rounds: roundsIso } },
      });
      // Each match whose own time changed.
      for (const m of matches) {
        const was = hhmmOf(m.ownStartsAt);
        const now = ownTimes[m.slug] ?? '';
        if (was === now) continue;
        await api.put(`/api/matches/${encodeURIComponent(m.slug)}/start-time`, {
          startsAt: now ? isoOn(day, now) : null,
        });
        m.ownStartsAt = now ? Math.floor(Date.parse(isoOn(day, now) as string) / 1000) : null;
      }
      showSuccess(t('schedulePage.saved'));
    } catch (error) {
      showError(apiErrorMessage(error, t('schedulePage.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const timesMode = times.mode === 'times';

  return (
    <Box
      data-testid="tournament-schedule-page"
      sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}
    >
      <PageHead title={t('schedulePage.title')} subtitle={t('schedulePage.intro')} />

      <Box component="section" aria-labelledby="schedule-rounds" sx={panel}>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <Typography
            id="schedule-rounds"
            component="h2"
            sx={{ m: 0, fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 700 }}
          >
            {t('schedulePage.rounds')}
          </Typography>
          <SegmentedControl
            label={t('schedulePage.modeLabel')}
            value={times.mode}
            onChange={(mode) => setTimes({ ...times, mode })}
            options={[
              { value: 'times', label: t('schedulePage.modeTimes') },
              { value: 'asap', label: t('schedulePage.modeAsap') },
            ]}
          />
        </Box>
        <Typography sx={{ m: 0, fontSize: '0.875rem', color: color.ink2 }}>
          {timesMode ? t('schedulePage.modeTimesNote') : t('schedulePage.modeAsapNote')}
        </Typography>

        {timesMode && (
          <>
            {rounds.length === 0 && (
              <Typography sx={{ color: color.muted }}>{t('schedulePage.noRounds')}</Typography>
            )}
            <Box
              component="ol"
              sx={{
                listStyle: 'none',
                m: 0,
                p: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              {rounds.map((round) => {
                const inRound = matches
                  .filter((m) => m.round === round)
                  .sort((a, b) => a.matchNumber - b.matchNumber);
                const id = `round-${round}-time`;
                return (
                  <Box
                    key={round}
                    component="li"
                    data-testid={`schedule-round-${round}`}
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                      px: 2,
                      py: 1.5,
                      borderRadius: radii.md,
                      bgcolor: color.paper3,
                    }}
                  >
                    <Box sx={ROW}>
                      <Box
                        component="button"
                        type="button"
                        aria-expanded={!!open[round]}
                        disabled={inRound.length === 0}
                        onClick={() => setOpen({ ...open, [round]: !open[round] })}
                        sx={{
                          all: 'unset',
                          cursor: inRound.length ? 'pointer' : 'default',
                          display: 'flex',
                          flexDirection: 'column',
                          minWidth: 0,
                          '&:focus-visible': {
                            outline: `2px solid ${color.focus}`,
                            outlineOffset: 2,
                            borderRadius: 1,
                          },
                        }}
                      >
                        <Typography component="span" sx={{ fontWeight: 600 }}>
                          {roundName(round)}
                        </Typography>
                        <Typography
                          component="span"
                          sx={{ fontSize: '0.8125rem', color: color.muted }}
                        >
                          {inRound.length
                            ? t('schedulePage.roundNote', { count: inRound.length })
                            : t('schedulePage.roundNoMatches')}
                        </Typography>
                      </Box>
                      <RowLabel htmlFor={id}>{t('schedulePage.roundStartsAt')}</RowLabel>
                      <TextField
                        id={id}
                        type="time"
                        size="small"
                        value={roundTimes[round] ?? ''}
                        onChange={(e) => setRoundTimes({ ...roundTimes, [round]: e.target.value })}
                        slotProps={{
                          htmlInput: {
                            'aria-label': t('schedulePage.roundTimeLabel', {
                              round: roundName(round),
                            }),
                            'data-testid': `schedule-round-${round}-time`,
                          },
                        }}
                      />
                      <Box sx={{ display: { xs: 'none', md: 'block' } }} />
                    </Box>
                    {open[round] &&
                      inRound.map((m) => {
                        const own = Boolean(ownTimes[m.slug]);
                        const mid = `match-${m.slug}-time`;
                        const name = `${m.team1?.name ?? t('schedulePage.tbd')} vs ${m.team2?.name ?? t('schedulePage.tbd')}`;
                        return (
                          <Box
                            key={m.slug}
                            data-testid={`schedule-match-${m.slug}`}
                            sx={{ ...ROW, pl: 2 }}
                          >
                            <Box
                              sx={{
                                display: 'inline-flex',
                                flexWrap: 'wrap',
                                alignItems: 'center',
                                gap: 1,
                                minWidth: 0,
                                fontSize: '0.875rem',
                              }}
                            >
                              {m.team1 && <TeamLogo team={m.team1} size="sm" />}
                              {m.team1?.name ?? t('schedulePage.tbd')}
                              <Box component="span" sx={{ color: color.muted }}>
                                vs
                              </Box>
                              {m.team2 && <TeamLogo team={m.team2} size="sm" />}
                              {m.team2?.name ?? t('schedulePage.tbd')}
                            </Box>
                            <RowLabel
                              htmlFor={mid}
                              color={own ? color.warning : color.muted}
                              bold={own}
                            >
                              {own ? t('schedulePage.ownTime') : t('schedulePage.sameAsRound')}
                            </RowLabel>
                            <TextField
                              id={mid}
                              type="time"
                              size="small"
                              value={ownTimes[m.slug] ?? ''}
                              placeholder={roundTimes[round] ?? ''}
                              onChange={(e) =>
                                setOwnTimes({ ...ownTimes, [m.slug]: e.target.value })
                              }
                              slotProps={{
                                htmlInput: {
                                  'aria-label': t('schedulePage.matchTimeLabel', { match: name }),
                                  'data-testid': `schedule-match-${m.slug}-time`,
                                },
                              }}
                              sx={{ '& input': { color: own ? color.ink : color.muted } }}
                            />
                            <Box sx={{ gridColumn: { xs: '1 / -1', md: 'auto' } }}>
                              {own && (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  fullWidth
                                  onClick={() => setOwnTimes({ ...ownTimes, [m.slug]: '' })}
                                >
                                  {t('schedulePage.useRoundTime')}
                                </Button>
                              )}
                            </Box>
                          </Box>
                        );
                      })}
                  </Box>
                );
              })}
            </Box>

            {(
              [
                ['veto', 'vetoLeadMinutes', [5, 10, 0]],
                ['reminder', 'reminderMinutes', [15, 30, 0]],
              ] as const
            ).map(([key, field, options]) => (
              <Box
                key={key}
                sx={{ ...ROW, px: 2, py: 1.5, borderRadius: radii.md, bgcolor: color.paper3 }}
              >
                <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <Typography component="span" sx={{ fontWeight: 600 }}>
                    {t(`schedulePage.${key}Title`)}
                  </Typography>
                  <Typography component="span" sx={{ fontSize: '0.8125rem', color: color.muted }}>
                    {t(`schedulePage.${key}Note`)}
                  </Typography>
                </Box>
                <RowLabel htmlFor={`schedule-${key}`}>{t(`schedulePage.${key}Label`)}</RowLabel>
                <TextField
                  id={`schedule-${key}`}
                  select
                  size="small"
                  value={times[field]}
                  onChange={(e) => setTimes({ ...times, [field]: Number(e.target.value) })}
                  slotProps={{ htmlInput: { 'data-testid': `schedule-${key}` } }}
                >
                  {options.map((n) => (
                    <MenuItem key={n} value={n}>
                      {n === 0
                        ? t(`schedulePage.${key}Zero`)
                        : t('schedulePage.minutesBefore', { count: n })}
                    </MenuItem>
                  ))}
                </TextField>
                <Box sx={{ display: { xs: 'none', md: 'block' } }} />
              </Box>
            ))}
          </>
        )}

        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={saving}
          data-testid="schedule-save"
          sx={{ alignSelf: 'flex-start' }}
        >
          {t('schedulePage.save')}
        </Button>
      </Box>

      <Box component="aside" aria-labelledby="schedule-rules" sx={panel}>
        <Typography
          id="schedule-rules"
          component="h2"
          sx={{ m: 0, fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 700 }}
        >
          {t('schedulePage.rulesTitle')}
        </Typography>
        <Box
          component="ul"
          sx={{
            m: 0,
            pl: 2.5,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            fontSize: '0.875rem',
            color: color.ink2,
          }}
        >
          {(['start', 'late', 'none', 'where'] as const).map((k) => (
            <Fragment key={k}>
              <li>{t(`schedulePage.rules.${k}`)}</li>
            </Fragment>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
