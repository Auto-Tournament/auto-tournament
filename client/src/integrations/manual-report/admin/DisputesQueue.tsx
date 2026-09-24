/**
 * The admin dispute queue (3.0 phase D, PR D8).
 *
 * Fills `adminDisputesView`, so the core `/disputes` page renders it without
 * knowing the module exists and a CS2 instance shows the page's "nothing to
 * settle here" instead — a CS2 result comes from the game server, and nobody
 * can disagree with it.
 *
 * **Two things land on this desk, not one.** `GET /api/game/manual/disputes`
 * asks for a report the opponent disagreed with *and* a report still
 * `submitted` whose deadline passed on a tournament that escalates rather than
 * auto-confirms. Each row says which it is (`reason`), because the two need
 * different reading: one is an argument, the other is silence.
 *
 * **The queue row is not enough to rule on.** It carries the open report only,
 * and what an admin has to weigh is what *each side* said — the withdrawn and
 * superseded revisions included. So opening a row reads the match
 * (`GET /matches/:slug`, which admins may call) and shows every revision, the
 * numbers filed with the one that stands, and the dispute's reason.
 *
 * **Two doors, which is what the API offers.** `resolve` with no result takes
 * the open report as it stands; `resolve` with one stores the admin's version
 * as its own revision and supersedes the open one, so the disagreement and the
 * ruling are both on the record. `reopen` is the third, for a match that has
 * to be played or reported again, and it enforces its own downstream checks —
 * tournament still running, nothing later started, nobody rated since — whose
 * refusal is shown verbatim rather than flattened into "that did not work".
 *
 * Live, on the same emit the team panel uses: every transition announces
 * itself with `emitTournament(…, 'match:report', …)`, so a dispute a captain
 * raises appears here, and one another admin settles leaves, without a reload.
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
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import GavelIcon from '@mui/icons-material/Gavel';
import type { AdminDisputesViewProps } from '../../types';
import {
  manualReportApi,
  type DisputeRow,
  type MatchReport,
  type MatchReportView,
  type ReportSide,
} from '../api';
import { RecordedStats } from '../match/RecordedStats';
import { StatFieldsForm } from '../match/StatFieldsForm';
import {
  draftFromRecorded,
  validateDraft,
  type DraftCheck,
  type StatDraft,
} from '../match/statFields';
import { useStatDraftLabels } from '../match/statFieldMessages';

/** How the admin is settling the open report. */
type Ruling = 'asReported' | 'own';

const emptyRows = (seriesLength: number) =>
  Array.from({ length: Math.max(1, seriesLength) }, () => ({ team1: '', team2: '' }));

/** Epoch **seconds** (what the API sends), as a local date and time. */
function when(seconds: number | null | undefined): string {
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleString();
}

/** The score to show for a report: the game's own for a bo1, else maps won. */
function scoreOf(report: Pick<MatchReport, 'result'>): string {
  const maps = report.result?.maps ?? [];
  if (maps.length === 1) return `${maps[0].team1Score} – ${maps[0].team2Score}`;
  return `${report.result?.seriesTeam1Score ?? 0} – ${report.result?.seriesTeam2Score ?? 0}`;
}

export function DisputesQueue({ tournamentId }: AdminDisputesViewProps) {
  const { t } = useModuleTranslation('manual-report');
  const statLabels = useStatDraftLabels();

  const [rows, setRows] = useState<DisputeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<MatchReportView | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [ruling, setRuling] = useState<Ruling>('asReported');
  const [scoreRows, setScoreRows] = useState(emptyRows(1));
  const [note, setNote] = useState('');
  const [statDraft, setStatDraft] = useState<StatDraft>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await manualReportApi.disputes(tournamentId);
    if (result.ok && result.data) {
      setRows(result.data.disputes);
      setError(null);
    } else {
      setRows([]);
      setError(result.error || t('disputes.errors.load'));
    }
  }, [tournamentId, t]);

  /**
   * Read one match's full report history.
   *
   * `reset` only when the row is being opened. A socket event re-reads the
   * same match, and refilling the score boxes then would wipe what the admin
   * had half-typed because the other side moved while they were looking at it.
   */
  const loadDetail = useCallback(async (slug: string, reset = false) => {
    const result = await manualReportApi.view(slug);
    const view = result.ok ? result.data : null;
    setDetail(view);
    if (view && reset) {
      // The admin's own result starts from the rules the match was built with,
      // and its stat cells from what already stands: `resolve` replaces the
      // whole set of values just as a report does, so blank cells erase them.
      setScoreRows(emptyRows(view.rules.seriesLength));
      setStatDraft(draftFromRecorded(view));
    }
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      await load();
      if (!live) return;
    })();
    return () => {
      live = false;
    };
  }, [load]);

  // Live, on the module's own emit. A dispute raised on a team page appears
  // here, and one another admin settles disappears, with no reload.
  useEffect(() => {
    const socket = io();
    const onReport = (data?: { matchSlug?: string }) => {
      void load();
      if (data?.matchSlug && data.matchSlug === openSlug) void loadDetail(data.matchSlug);
    };
    socket.on('match:report', onReport);
    return () => {
      socket.off('match:report', onReport);
      socket.close();
    };
  }, [load, loadDetail, openSlug]);

  const openRow = useCallback(
    (row: DisputeRow) => {
      if (openSlug === row.matchSlug) {
        setOpenSlug(null);
        setDetail(null);
        return;
      }
      setOpenSlug(row.matchSlug);
      setDetail(null);
      setDetailLoading(true);
      setRuling('asReported');
      setNote('');
      setActionError(null);
      void loadDetail(row.matchSlug, true);
    },
    [openSlug, loadDetail]
  );

  const teamName = useCallback(
    (view: MatchReportView, side: ReportSide) => view.match[side].name || t('manualReport.unknownTeam'),
    [t]
  );

  const act = useCallback(
    async (run: () => Promise<{ ok: boolean; error: string | null }>) => {
      setBusy(true);
      setActionError(null);
      const result = await run();
      if (result.ok) {
        setOpenSlug(null);
        setDetail(null);
        await load();
      } else {
        // `reopen` refuses with the reason it refused (a later match has
        // started, a player has been rated since). That sentence is the whole
        // value of the button, so it is shown as it came.
        setActionError(result.error || t('disputes.errors.action'));
      }
      setBusy(false);
    },
    [load, t]
  );

  const submitRuling = useCallback(() => {
    if (!detail || !openSlug) return;
    if (ruling === 'asReported') {
      void act(() => manualReportApi.resolve(openSlug));
      return;
    }
    const maps = scoreRows
      .filter((row) => row.team1.trim() !== '' && row.team2.trim() !== '')
      .map((row) => ({ team1Score: Number(row.team1), team2Score: Number(row.team2) }));
    if (maps.length === 0) {
      setActionError(t('manualReport.errors.incomplete'));
      return;
    }
    const checked: DraftCheck =
      detail.fields?.length
        ? validateDraft(detail, detail.fields, statDraft, statLabels)
        : { ok: true, values: [] };
    if (!checked.ok) {
      setActionError(checked.error);
      return;
    }
    void act(() =>
      manualReportApi.resolve(
        openSlug,
        { maps, ...(note.trim() ? { note: note.trim() } : {}) },
        checked.values
      )
    );
  }, [detail, openSlug, ruling, scoreRows, statDraft, statLabels, note, act, t]);

  const buttonSx = { width: { xs: '100%', sm: 'auto' } };

  const reopenable = useMemo(
    () =>
      detail !== null &&
      (detail.match.status === 'completed' || detail.match.status === 'needs_decision'),
    [detail]
  );

  if (rows === null) {
    return (
      <Box display="flex" justifyContent="center" py={6} data-testid="disputes-loading">
        <CircularProgress />
      </Box>
    );
  }

  if (rows.length === 0) {
    return (
      <Card data-testid="disputes-empty">
        <CardContent sx={{ textAlign: 'center', py: 6 }}>
          <GavelIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            {t('disputes.empty.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('disputes.empty.hint')}
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mt: 2, textAlign: 'left' }} data-testid="disputes-error">
              {error}
            </Alert>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Stack spacing={2} data-testid="disputes-list">
      {rows.map((row) => {
        const expanded = openSlug === row.matchSlug;
        return (
          <Card key={row.matchSlug} data-testid={`dispute-row-${row.matchSlug}`}>
            <CardContent>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', sm: 'center' }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={row.reason === 'disputed' ? 'warning' : 'default'}
                      data-testid={`dispute-reason-${row.matchSlug}`}
                      data-reason={row.reason}
                      label={t(`disputes.reason.${row.reason}`)}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {t('disputes.roundLabel', { round: row.round })}
                      {row.bracket ? ` · ${row.bracket}` : ''}
                    </Typography>
                  </Stack>
                  <Typography variant="h6" mt={0.5} sx={{ overflowWrap: 'anywhere' }}>
                    {row.team1.name || t('manualReport.unknownTeam')}
                    {' — '}
                    {row.team2.name || t('manualReport.unknownTeam')}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    data-testid={`dispute-reported-${row.matchSlug}`}
                  >
                    {t('disputes.reportedBy', {
                      team:
                        (row.report.submittedByTeam
                          ? row[row.report.submittedByTeam].name
                          : null) || t('disputes.byAdmin'),
                      score: scoreOf(row.report),
                      at: when(row.report.disputedAt ?? row.report.createdAt),
                    })}
                  </Typography>
                  {row.report.disputeReason && (
                    <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                      {t('manualReport.disputeReasonGiven', { reason: row.report.disputeReason })}
                    </Typography>
                  )}
                </Box>
                <Button
                  variant={expanded ? 'outlined' : 'contained'}
                  color={expanded ? 'inherit' : 'primary'}
                  sx={buttonSx}
                  data-testid={`dispute-review-${row.matchSlug}`}
                  onClick={() => openRow(row)}
                >
                  {t(expanded ? 'disputes.actions.close' : 'disputes.actions.review')}
                </Button>
              </Stack>

              <Collapse in={expanded} unmountOnExit>
                <Divider sx={{ my: 2 }} />
                {detailLoading && (
                  <Box display="flex" justifyContent="center" py={3}>
                    <CircularProgress size={24} />
                  </Box>
                )}
                {detail && (
                  <Box data-testid="dispute-detail">
                    {/* What each side said, oldest first: an admin ruling on a
                        disagreement needs both versions, not just the open one. */}
                    <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                      {t('disputes.history')}
                    </Typography>
                    <Stack spacing={0.5}>
                      {[...detail.reports]
                        .sort((a, b) => a.revision - b.revision)
                        .map((report) => (
                          <Typography
                            key={report.revision}
                            variant="body2"
                            color="text.secondary"
                            data-testid={`dispute-report-${report.revision}`}
                            data-status={report.status}
                            sx={{ overflowWrap: 'anywhere' }}
                          >
                            {t('disputes.revision', {
                              revision: report.revision,
                              team:
                                (report.submittedByTeam
                                  ? teamName(detail, report.submittedByTeam)
                                  : null) || t('disputes.byAdmin'),
                              score: scoreOf(report),
                              status: t(`disputes.status.${report.status}`),
                              at: when(report.createdAt),
                            })}
                          </Typography>
                        ))}
                    </Stack>

                    <RecordedStats view={detail} testId="dispute-recorded-stats" />

                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                      {t('disputes.ruling.title')}
                    </Typography>
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={ruling}
                      onChange={(_event, value: Ruling | null) => value && setRuling(value)}
                      sx={{ flexWrap: 'wrap' }}
                    >
                      <ToggleButton value="asReported" data-testid="dispute-resolve-as-reported">
                        {t('disputes.ruling.asReported')}
                      </ToggleButton>
                      <ToggleButton value="own" data-testid="dispute-resolve-own">
                        {t('disputes.ruling.own')}
                      </ToggleButton>
                    </ToggleButtonGroup>

                    <Collapse in={ruling === 'own'} unmountOnExit>
                      <Stack spacing={1.5} mt={2} data-testid="dispute-own-form">
                        <Typography variant="body2" color="text.secondary">
                          {t('manualReport.formHint', {
                            team1: teamName(detail, 'team1'),
                            team2: teamName(detail, 'team2'),
                          })}
                        </Typography>
                        {scoreRows.map((scoreRow, index) => (
                          <Stack
                            key={index}
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={1}
                            alignItems={{ xs: 'stretch', sm: 'center' }}
                          >
                            {detail.rules.seriesLength > 1 && (
                              <Typography variant="body2" color="text.secondary" sx={{ minWidth: 72 }}>
                                {t('manualReport.game', { number: index + 1 })}
                              </Typography>
                            )}
                            <TextField
                              size="small"
                              type="number"
                              label={teamName(detail, 'team1')}
                              value={scoreRow.team1}
                              inputProps={{
                                min: 0,
                                'data-testid': `dispute-game-${index + 1}-team1`,
                              }}
                              onChange={(event) =>
                                setScoreRows((prev) =>
                                  prev.map((r, i) =>
                                    i === index ? { ...r, team1: event.target.value } : r
                                  )
                                )
                              }
                            />
                            <TextField
                              size="small"
                              type="number"
                              label={teamName(detail, 'team2')}
                              value={scoreRow.team2}
                              inputProps={{
                                min: 0,
                                'data-testid': `dispute-game-${index + 1}-team2`,
                              }}
                              onChange={(event) =>
                                setScoreRows((prev) =>
                                  prev.map((r, i) =>
                                    i === index ? { ...r, team2: event.target.value } : r
                                  )
                                )
                              }
                            />
                          </Stack>
                        ))}

                        {detail.fields && detail.fields.length > 0 && (
                          <StatFieldsForm
                            view={detail}
                            fields={detail.fields}
                            draft={statDraft}
                            disabled={busy}
                            testIdPrefix="dispute"
                            onChange={(cell, value) =>
                              setStatDraft((prev) => ({ ...prev, [cell]: value }))
                            }
                          />
                        )}

                        <TextField
                          size="small"
                          fullWidth
                          multiline
                          minRows={2}
                          label={t('disputes.ruling.note')}
                          placeholder={t('disputes.ruling.notePlaceholder')}
                          value={note}
                          inputProps={{ maxLength: 500, 'data-testid': 'dispute-note' }}
                          onChange={(event) => setNote(event.target.value)}
                        />
                      </Stack>
                    </Collapse>

                    {actionError && (
                      <Alert severity="error" sx={{ mt: 2 }} data-testid="dispute-error">
                        {actionError}
                      </Alert>
                    )}

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} mt={2} useFlexGap>
                      <Button
                        variant="contained"
                        color="primary"
                        disabled={busy}
                        sx={buttonSx}
                        data-testid="dispute-resolve-submit"
                        onClick={submitRuling}
                      >
                        {t('disputes.actions.resolve')}
                      </Button>
                      {reopenable && (
                        <Button
                          variant="outlined"
                          color="inherit"
                          disabled={busy}
                          sx={buttonSx}
                          data-testid="dispute-reopen"
                          onClick={() => void act(() => manualReportApi.reopen(row.matchSlug))}
                        >
                          {t('disputes.actions.reopen')}
                        </Button>
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                      {t(reopenable ? 'disputes.reopenHint' : 'disputes.reopenUnavailable')}
                    </Typography>
                  </Box>
                )}
              </Collapse>
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
}
