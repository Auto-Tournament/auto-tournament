/**
 * The team side of manual result reporting (3.0 phase D, PR D7).
 *
 * Fills the `matchPanels.reportView` slot, so the team match page renders it
 * without knowing the module exists — and CS2, which leaves the slot empty,
 * shows nothing in its place. A CS2 result comes from the game server; this is
 * for every other title, where the only people who know the score are the two
 * captains.
 *
 * Three things it has to get right:
 *
 * **Say where the match is, in words.** A captain looking at this wants to
 * know whether they are waiting on the other team, the other team is waiting
 * on them, or it is already settled. The five states come straight off the
 * API's own answer (`open`, its status and who submitted it) rather than being
 * recomputed here, so the panel and the state machine cannot disagree.
 *
 * **Offer only what the API would allow.** `viewer.canReport` / `canConfirm` /
 * `canDispute` / `canWithdraw` are computed by the route, so a button is
 * absent rather than present and answered with a 403.
 *
 * **Name the revision when confirming.** Two captains on one match race: a
 * second report supersedes the first and takes the next revision. `confirm`
 * carries the revision the panel has on screen, and a 409 means the result
 * being agreed to is not the one that was read — so the panel reloads and says
 * so instead of quietly succeeding on a different score.
 *
 * Live updates ride the module's existing emit: every transition announces
 * itself with `emitTournament(..., 'match:report', …)`, so both captains see
 * each other's moves without reloading.
 *
 * **The tournament's custom fields** (3.0 phase D, PR D8) are part of the form
 * rather than an afterthought: D7 shipped scores only while D6 was still
 * writing the API side of them. They are checked against the same rules the
 * API applies (`./statFields`) before anything is sent, because the API
 * refuses the *whole* report — the score with it — on a single bad value.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useModuleTranslation } from '../../../module-sdk';
import { io } from 'socket.io-client';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import type { MatchReportPanelProps } from '../../types';
import {
  isNotOurs,
  manualReportApi,
  type MatchReport,
  type MatchReportView,
  type ReportSide,
} from '../api';
import { RecordedStats } from './RecordedStats';
import { StatFieldsForm } from './StatFieldsForm';
import {
  draftFromRecorded,
  validateDraft,
  type DraftCheck,
  type StatDraft,
} from './statFields';
import { useStatDraftLabels } from './statFieldMessages';

/** Which of the five sentences the panel is showing. */
type PanelState =
  | 'nothing'
  | 'waitingOpponent'
  | 'needsAnswer'
  | 'disputed'
  | 'awaitingAdmin'
  | 'confirmed';

/**
 * Match statuses a result may still be reported for, the same set
 * `submitReport` enforces. `viewer.canReport` only says whether an open report
 * is in the way, so a settled match would otherwise keep offering a button
 * whose only possible answer is "reopen it first".
 */
const REPORTABLE_MATCH_STATUSES = new Set(['ready', 'loaded', 'live', 'needs_decision']);

/** An empty score row per game of the series. */
const emptyRows = (seriesLength: number) =>
  Array.from({ length: Math.max(1, seriesLength) }, () => ({ team1: '', team2: '' }));

function stateOf(view: MatchReportView): PanelState {
  const open = view.open;
  if (open?.status === 'disputed') return 'disputed';
  if (view.match.status === 'needs_decision') return 'awaitingAdmin';
  if (open?.status === 'submitted') {
    // "Mine, waiting on them" vs "theirs, waiting on me". An admin who captains
    // neither team may answer, so they get the answerable wording too.
    return view.viewer.canConfirm ? 'needsAnswer' : 'waitingOpponent';
  }
  if (view.reports.some((report) => report.status === 'confirmed')) return 'confirmed';
  return 'nothing';
}

/** The score to show big: the game's own for a one-game series, else maps won. */
function headlineScore(report: MatchReport | null): { team1: number; team2: number } {
  if (!report) return { team1: 0, team2: 0 };
  const only = report.result.maps.length === 1 ? report.result.maps[0] : null;
  return only
    ? { team1: only.team1Score, team2: only.team2Score }
    : { team1: report.result.seriesTeam1Score, team2: report.result.seriesTeam2Score };
}

/** The report the panel describes: the open one, else the confirmed one. */
function shownReport(view: MatchReportView): MatchReport | null {
  return view.open ?? view.reports.find((report) => report.status === 'confirmed') ?? null;
}

export function ManualReportPanel({ matchSlug, matchStatus }: MatchReportPanelProps) {
  const { t } = useModuleTranslation('manual-report');

  const [view, setView] = useState<MatchReportView | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [rows, setRows] = useState<Array<{ team1: string; team2: string }>>(emptyRows(1));
  const [note, setNote] = useState('');
  /** The tournament's custom fields, as typed in (PR D8). */
  const [statDraft, setStatDraft] = useState<StatDraft>({});
  const statLabels = useStatDraftLabels();

  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');

  // The clock the deadline line is measured against, moved on by the interval
  // below so the minutes left keep counting down while the panel is open.
  const [now, setNow] = useState(() => Date.now());

  /** What an answered read does to the panel. */
  const apply = useCallback((result: Awaited<ReturnType<typeof manualReportApi.view>>) => {
    if (result.ok && result.data) {
      setView(result.data);
      setHidden(false);
    } else if (isNotOurs(result.status)) {
      // A spectator, someone on neither team, or a match another module owns.
      // None of those is an error worth a red box on a public page.
      setHidden(true);
    }
    setLoading(false);
  }, []);

  /**
   * Re-read the match.
   *
   * Never sets a spinner: the first read has one because `loading` starts
   * true, and every later read is either a socket event or an action this
   * captain just took. Flashing the card empty under them for each of those
   * would be worse than a value half a second stale.
   */
  const load = useCallback(async (): Promise<void> => {
    apply(await manualReportApi.view(matchSlug));
  }, [matchSlug, apply]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const result = await manualReportApi.view(matchSlug);
      if (!live) return;
      apply(result);
    })();
    return () => {
      live = false;
    };
  }, [matchSlug, matchStatus, apply]);

  useEffect(() => {
    const socket = io();
    const onReport = (data?: { matchSlug?: string }) => {
      if (data?.matchSlug && data.matchSlug !== matchSlug) return;
      void load();
    };
    socket.on('match:report', onReport);
    return () => {
      socket.off('match:report', onReport);
      socket.close();
    };
  }, [matchSlug, load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const teamName = useCallback(
    (side: ReportSide | null): string => {
      if (!view || !side) return t('manualReport.unknownTeam');
      return view.match[side].name || t('manualReport.unknownTeam');
    },
    [view, t]
  );

  const state = view ? stateOf(view) : 'nothing';
  const report = view ? shownReport(view) : null;

  const deadline = useMemo(() => {
    const open = view?.open;
    if (!open || open.status !== 'submitted' || open.confirmDeadline === null) return null;
    const minutes = Math.round((open.confirmDeadline * 1000 - now) / 60_000);
    const action = open.timeoutAction === 'escalate' ? 'escalate' : 'autoConfirm';
    if (minutes <= 0) return t(`manualReport.deadline.${action}Soon`);
    return t(`manualReport.deadline.${action}`, { minutes });
  }, [view, now, t]);

  const act = useCallback(
    async (run: () => Promise<{ ok: boolean; status: number; error: string | null }>) => {
      setBusy(true);
      setError(null);
      setStale(false);
      const result = await run();
      if (result.ok) {
        setFormOpen(false);
        setDisputeOpen(false);
        setDisputeReason('');
        setNote('');
        await load();
      } else if (result.status === 409) {
        // The report moved while it was on screen. Reload and say so: the whole
        // point of naming a revision is that this cannot pass silently.
        setStale(true);
        await load();
      } else {
        setError(result.error || t('manualReport.errors.failed'));
      }
      setBusy(false);
    },
    [load, t]
  );

  const openForm = () => {
    setRows(emptyRows(view?.rules.seriesLength ?? 1));
    setNote('');
    setError(null);
    // Prefilled with whatever stands, not blank. A report **replaces** the
    // match's whole set of values (`replaceValues`), so a form that started
    // empty would quietly delete every number already recorded the moment
    // somebody corrected a score.
    setStatDraft(view ? draftFromRecorded(view) : {});
    setFormOpen(true);
  };

  const submitReport = () => {
    const maps = rows
      .filter((row) => row.team1.trim() !== '' && row.team2.trim() !== '')
      .map((row) => ({ team1Score: Number(row.team1), team2Score: Number(row.team2) }));
    if (maps.length === 0) {
      setError(t('manualReport.errors.incomplete'));
      return;
    }
    // Checked here as well as by the API, which refuses the whole report —
    // score included — on one bad value. Saying which field while the captain
    // is still looking at it beats handing the refusal back as prose.
    const checked: DraftCheck =
      view?.fields?.length
        ? validateDraft(view, view.fields, statDraft, statLabels)
        : { ok: true, values: [] };
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    void act(() =>
      manualReportApi.report(
        matchSlug,
        { maps, ...(note.trim() ? { note: note.trim() } : {}) },
        checked.values
      )
    );
  };

  if (hidden) return null;

  if (loading) {
    return (
      <Card data-testid="manual-report-panel">
        <CardContent sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={24} />
        </CardContent>
      </Card>
    );
  }

  if (!view) return null;

  const { viewer, rules } = view;
  const opponent: ReportSide | null =
    viewer.team === 'team1' ? 'team2' : viewer.team === 'team2' ? 'team1' : null;
  const reporterName = report ? teamName(report.submittedByTeam) : '';

  const stateText = t(`manualReport.state.${state}`, {
    team: state === 'waitingOpponent' ? teamName(opponent) : reporterName,
  });

  const mayReport = viewer.canReport && REPORTABLE_MATCH_STATUSES.has(view.match.status);
  // A one-game series has no maps-won score worth showing: a captain who typed
  // 3-1 should not be told the result is 1-0. Anything longer is scored in
  // games won, with the individual games on the chips below.
  const headline = headlineScore(report);
  const canAnswer = viewer.canConfirm || viewer.canDispute;
  const buttonSx = { width: { xs: '100%', sm: 'auto' } };

  return (
    <Card data-testid="manual-report-panel">
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <FactCheckIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            {t('manualReport.title')}
          </Typography>
        </Box>

        <Typography
          variant="body1"
          color="text.primary"
          data-testid="manual-report-state"
          data-state={state}
          sx={{ overflowWrap: 'anywhere' }}
        >
          {stateText}
        </Typography>

        {deadline && (
          <Typography variant="body2" color="text.secondary" mt={0.5} data-testid="manual-report-deadline">
            {deadline}
          </Typography>
        )}

        {report && (
          <Box mt={2} data-testid="manual-report-score">
            <Typography variant="h5" sx={{ overflowWrap: 'anywhere' }}>
              {t('manualReport.score', {
                team1: teamName('team1'),
                score1: headline.team1,
                score2: headline.team2,
                team2: teamName('team2'),
              })}
            </Typography>
            {rules.seriesLength > 1 && (
              <Stack direction="row" flexWrap="wrap" gap={1} mt={1}>
                {report.result.maps.map((game) => (
                  <Chip
                    key={game.mapNumber}
                    size="small"
                    variant="outlined"
                    label={`${t('manualReport.game', { number: game.mapNumber })} ${game.team1Score}-${game.team2Score}`}
                  />
                ))}
              </Stack>
            )}
            {report.result.note && (
              <Typography variant="body2" color="text.secondary" mt={1} sx={{ overflowWrap: 'anywhere' }}>
                {t('manualReport.noteGiven', { note: report.result.note })}
              </Typography>
            )}
            {report.disputeReason && (
              <Typography variant="body2" color="text.secondary" mt={1} sx={{ overflowWrap: 'anywhere' }}>
                {t('manualReport.disputeReasonGiven', { reason: report.disputeReason })}
              </Typography>
            )}
            {/* What was filed with the score. The opponent is being asked to
                agree with these too, so they have to be on screen before the
                Confirm button is. */}
            <RecordedStats view={view} />
          </Box>
        )}

        {stale && (
          <Alert severity="warning" sx={{ mt: 2 }} data-testid="manual-report-stale">
            {t('manualReport.errors.stale')}
          </Alert>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }} data-testid="manual-report-error">
            {error}
          </Alert>
        )}

        {(mayReport || canAnswer || viewer.canWithdraw) && (
          <>
            <Divider sx={{ my: 2 }} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} flexWrap="wrap" useFlexGap>
              {viewer.canConfirm && view.open && (
                <Button
                  variant="contained"
                  color="primary"
                  disabled={busy}
                  sx={buttonSx}
                  data-testid="manual-report-confirm"
                  onClick={() => void act(() => manualReportApi.confirm(matchSlug, view.open!.revision))}
                >
                  {t('manualReport.actions.confirm')}
                </Button>
              )}
              {viewer.canDispute && view.open && (
                <Button
                  variant="outlined"
                  color="inherit"
                  disabled={busy}
                  sx={buttonSx}
                  data-testid="manual-report-dispute"
                  onClick={() => {
                    setDisputeOpen((open) => !open);
                    setFormOpen(false);
                  }}
                >
                  {t('manualReport.actions.dispute')}
                </Button>
              )}
              {mayReport && (
                <Button
                  variant={state === 'nothing' ? 'contained' : 'outlined'}
                  color={state === 'nothing' ? 'primary' : 'inherit'}
                  disabled={busy}
                  sx={buttonSx}
                  data-testid="manual-report-open-form"
                  onClick={() => {
                    setDisputeOpen(false);
                    if (formOpen) setFormOpen(false);
                    else openForm();
                  }}
                >
                  {t(state === 'nothing' ? 'manualReport.actions.report' : 'manualReport.actions.reportAgain')}
                </Button>
              )}
              {viewer.canWithdraw && view.open && (
                <Button
                  variant="text"
                  color="inherit"
                  disabled={busy}
                  sx={buttonSx}
                  data-testid="manual-report-withdraw"
                  onClick={() => void act(() => manualReportApi.withdraw(matchSlug, view.open!.revision))}
                >
                  {t('manualReport.actions.withdraw')}
                </Button>
              )}
            </Stack>
          </>
        )}

        <Collapse in={formOpen} unmountOnExit>
          <Box mt={2} data-testid="manual-report-form">
            <Typography variant="body2" color="text.secondary" mb={1.5}>
              {t('manualReport.formHint', { team1: teamName('team1'), team2: teamName('team2') })}
            </Typography>
            <Stack spacing={1.5}>
              {rows.map((row, index) => (
                <Stack
                  key={index}
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  alignItems={{ xs: 'stretch', sm: 'center' }}
                >
                  {rules.seriesLength > 1 && (
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 72 }}>
                      {t('manualReport.game', { number: index + 1 })}
                    </Typography>
                  )}
                  <TextField
                    size="small"
                    type="number"
                    label={teamName('team1')}
                    value={row.team1}
                    inputProps={{ min: 0, 'data-testid': `manual-report-game-${index + 1}-team1` }}
                    onChange={(event) =>
                      setRows((prev) =>
                        prev.map((r, i) => (i === index ? { ...r, team1: event.target.value } : r))
                      )
                    }
                  />
                  <TextField
                    size="small"
                    type="number"
                    label={teamName('team2')}
                    value={row.team2}
                    inputProps={{ min: 0, 'data-testid': `manual-report-game-${index + 1}-team2` }}
                    onChange={(event) =>
                      setRows((prev) =>
                        prev.map((r, i) => (i === index ? { ...r, team2: event.target.value } : r))
                      )
                    }
                  />
                </Stack>
              ))}
              {view.fields && view.fields.length > 0 && (
                <>
                  <Divider />
                  <StatFieldsForm
                    view={view}
                    fields={view.fields}
                    draft={statDraft}
                    disabled={busy}
                    testIdPrefix="manual-report"
                    onChange={(cell, value) =>
                      setStatDraft((prev) => ({ ...prev, [cell]: value }))
                    }
                  />
                </>
              )}
              <TextField
                size="small"
                fullWidth
                multiline
                minRows={2}
                label={t('manualReport.note')}
                placeholder={t('manualReport.notePlaceholder')}
                value={note}
                inputProps={{ maxLength: 500, 'data-testid': 'manual-report-note' }}
                onChange={(event) => setNote(event.target.value)}
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button
                  variant="contained"
                  color="primary"
                  disabled={busy}
                  sx={buttonSx}
                  data-testid="manual-report-submit"
                  onClick={submitReport}
                >
                  {t('manualReport.actions.submit')}
                </Button>
                <Button
                  variant="text"
                  color="inherit"
                  disabled={busy}
                  sx={buttonSx}
                  data-testid="manual-report-cancel"
                  onClick={() => setFormOpen(false)}
                >
                  {t('manualReport.actions.cancel')}
                </Button>
              </Stack>
            </Stack>
          </Box>
        </Collapse>

        <Collapse in={disputeOpen} unmountOnExit>
          <Box mt={2} data-testid="manual-report-dispute-form">
            <Stack spacing={1.5}>
              <TextField
                size="small"
                fullWidth
                multiline
                minRows={2}
                label={t('manualReport.disputeReason')}
                value={disputeReason}
                inputProps={{ maxLength: 500, 'data-testid': 'manual-report-dispute-reason' }}
                onChange={(event) => setDisputeReason(event.target.value)}
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button
                  variant="contained"
                  color="primary"
                  disabled={busy || !view.open}
                  sx={buttonSx}
                  data-testid="manual-report-dispute-submit"
                  onClick={() =>
                    view.open &&
                    void act(() =>
                      manualReportApi.dispute(matchSlug, view.open!.revision, disputeReason)
                    )
                  }
                >
                  {t('manualReport.actions.disputeSubmit')}
                </Button>
                <Button
                  variant="text"
                  color="inherit"
                  disabled={busy}
                  sx={buttonSx}
                  onClick={() => setDisputeOpen(false)}
                >
                  {t('manualReport.actions.cancel')}
                </Button>
              </Stack>
            </Stack>
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
}
