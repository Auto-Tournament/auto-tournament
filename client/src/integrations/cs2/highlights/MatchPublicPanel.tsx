/**
 * CS2's part of a finished match's public page (`matchPanels.publicView`):
 * the team reels in the platform's player (music, crowd, chapters), the
 * scoreboard over the whole match from the demos, and every highlight clip.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, ButtonBase, LinearProgress, Stack, Typography } from '@mui/material';
import {
  api,
  fontDisplay,
  HighlightPlayer,
  links,
  mono,
  radii,
  textSize,
  tokens,
  useModuleTranslation,
  useSocket,
  type HighlightPlayerHandle,
  type MusicTrack,
  SegmentedControl,
  fmtNum,
} from '../../../module-sdk';
import type { MatchPublicPanelProps } from '../../types';
import { clock, kindLabel, libraryPath, mapLabel, watchTeamReelPath, type Chapter } from './data';
import { MatchClipGrid, type MatchClip } from './MatchClipGrid';

/** A recorder working on this match, as its link reports it. */
interface LiveRecording {
  recorder: string;
  step: string;
  detail: string | null;
  mapNumber: number | null;
  done: number | null;
  total: number | null;
  percent: number | null;
}

interface TeamReelRow {
  teamId: string;
  team: string | null;
  status: string;
  video: string | null;
}

interface TeamReel {
  video: string;
  crowd?: string | null;
  team: string | null;
  chapters: Chapter[];
}

interface Line {
  playerId: string;
  name: string;
  avatar: string | null;
  rounds: number;
  kills: number;
  deaths: number;
  assists: number;
  adr: number;
  hsPercent: number;
  kast: number;
  entryKills: number;
}

export function MatchPublicPanel({ matchSlug, match }: MatchPublicPanelProps) {
  const { t } = useModuleTranslation('cs2');
  const [teams, setTeams] = useState<TeamReelRow[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [reel, setReel] = useState<TeamReel | null>(null);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [board, setBoard] = useState<{
    team1: Line[];
    team2: Line[];
    maps: Array<{ mapNumber: number; team1: Line[]; team2: Line[] }>;
  } | null>(null);
  // The scoreboard's map: the whole match, or one map of it.
  const [boardMap, setBoardMap] = useState<'all' | number>('all');
  const [clips, setClips] = useState<MatchClip[]>([]);
  // How many of the match's clips are made, while recorders are still on it.
  const [progress, setProgress] = useState<{ done: number; total: number; waiting: number } | null>(
    null
  );
  const [time, setTime] = useState(0);
  const player = useRef<HighlightPlayerHandle>(null);
  const enc = encodeURIComponent;

  // New clips and reels arrive while the page is open (recorders finish them
  // one by one): the server says so over the socket, and they are read again.
  const socket = useSocket();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const event = `highlights:update:${matchSlug}`;
    // A burst (a map's clips finishing together) reads them once.
    const changed = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setVersion((v) => v + 1), 1500);
    };
    socket.on(event, changed);
    return () => {
      socket.off(event, changed);
      if (timer) clearTimeout(timer);
    };
  }, [socket, matchSlug]);

  // Who is recording this match right now, and how far (the recorders' live
  // link): one line per recorder, gone when it is done.
  const [live, setLive] = useState<Record<string, LiveRecording>>({});
  useEffect(() => {
    const event = `highlights:progress:${matchSlug}`;
    const onProgress = (p: LiveRecording & { step: string | null }) =>
      setLive((prev) => {
        const next = { ...prev };
        if (p.step) next[p.recorder] = p;
        else delete next[p.recorder];
        return next;
      });
    socket.on(event, onProgress);
    return () => {
      socket.off(event, onProgress);
    };
  }, [socket, matchSlug]);

  useEffect(() => {
    let cancelled = false;
    void api
      .get<{ teams: TeamReelRow[] }>(`/api/game/cs2/matches/${enc(matchSlug)}/reels`)
      .then((r) => {
        if (cancelled) return;
        const done = (r.teams ?? []).filter((x) => x.status === 'done' && x.video);
        setTeams(done);
        // The winners' reel first; a reel already picked stays picked.
        const winner = match.winnerSide ? match[match.winnerSide]?.id : null;
        setPick(
          (current) =>
            (current && done.some((x) => x.teamId === current) ? current : null) ??
            (done.find((x) => x.teamId === winner) ?? done[0])?.teamId ??
            null
        );
      })
      .catch(() => undefined);
    void api
      .get<{
        team1: Line[];
        team2: Line[];
        maps?: Array<{ mapNumber: number; team1: Line[]; team2: Line[] }>;
      }>(`/api/game/cs2/matches/${enc(matchSlug)}/scoreboard`)
      .then((r) => !cancelled && setBoard({ team1: r.team1, team2: r.team2, maps: r.maps ?? [] }))
      .catch(() => undefined);
    void api
      .get<{
        clips: MatchClip[];
        progress?: { done: number; total: number; waiting: number };
      }>(`/api/game/cs2/matches/${enc(matchSlug)}/highlights`)
      .then((r) => {
        if (cancelled) return;
        setClips(r.clips);
        setProgress(r.progress ?? null);
      })
      .catch(() => undefined);
    void api
      .get<{ tracks: MusicTrack[] }>('/api/highlights/music')
      .then((r) => !cancelled && setTracks(r.tracks))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per match, and again when its highlights change
  }, [matchSlug, version]);

  useEffect(() => {
    if (!pick) return;
    let cancelled = false;
    setReel(null);
    void api
      .get<{ reel: TeamReel }>(`/api/game/cs2/watch/team/${enc(matchSlug)}/${enc(pick)}`)
      .then((r) => !cancelled && setReel(r.reel))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per team
  }, [matchSlug, pick]);

  const chapters = useMemo(() => (reel?.chapters ?? []).filter((c) => c.at !== null), [reel]);
  const current = chapters.reduce((at, c, i) => ((c.at ?? 0) <= time + 0.05 ? i : at), -1);

  // Each part is its own panel (the drafts' finished match room).
  const panelSx = {
    p: { xs: 2.5, sm: 3 },
    borderRadius: radii.lg,
    bgcolor: tokens.color.paper2,
    border: `1px solid ${tokens.color.rule}`,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  } as const;
  const h2 = { m: 0, fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 700 } as const;
  const section = (title: string, children: ReactNode, testid: string, action?: ReactNode) => (
    <Box component="section" sx={panelSx} data-testid={testid}>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
        }}
      >
        <Typography component="h2" sx={h2}>
          {title}
        </Typography>
        {action}
      </Box>
      {children}
    </Box>
  );

  const teamName = (side: 'team1' | 'team2') => match[side]?.name ?? '';
  const recording = (progress?.waiting ?? 0) > 0;
  // A rating from the line, around 1.00 (the live table's): kills, survival and damage per round.
  const rating = (l: Line) => {
    const rounds = Math.max(1, l.rounds || 0);
    return (
      0.36 * (l.kills / rounds / 0.68) +
      0.34 * ((rounds - l.deaths) / rounds / 0.32) * 0.33 +
      0.3 * (l.adr / 75) +
      0.11
    );
  };
  const shownBoard =
    board && boardMap !== 'all'
      ? (board.maps.find((m) => m.mapNumber === boardMap) ?? board)
      : board;
  const mapsInBoard = board?.maps ?? [];
  const opt = { display: { xs: 'none', sm: 'table-cell' } } as const;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {reel && (
        <Box component="section" sx={panelSx} data-testid="match-page-reel">
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1.8fr) minmax(0, 1fr)' },
              gap: 3,
              alignItems: 'start',
            }}
          >
            <HighlightPlayer
              ref={player}
              src={reel.video}
              label={t('highlights.watch.teamReel', { team: reel.team ?? '' })}
              chapterStarts={chapters.map((c) => c.at as number)}
              chapterInfo={chapters.map((c) => ({
                title: `${c.playerName} · ${kindLabel(t, c.kind, c.clutch)}`,
                sub: [c.map ? mapLabel(t, c.map, 0) : null, t('highlights.roundN', { n: c.round })]
                  .filter(Boolean)
                  .join(' · '),
                thumb: `/api/game/cs2/highlights/${c.highlightId}.mp4`,
              }))}
              downloadName={`${reel.team ?? 'team'}-highlights.mp4`}
              crowd={reel.crowd ?? null}
              music={
                tracks.length > 0 ? { tracks, introEnd: Math.max(0, chapters[0]?.at ?? 0) } : null
              }
              onTime={setTime}
            />
            <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Typography component="h2" sx={h2}>
                {t('highlights.watch.teamReel', { team: reel.team ?? '' })}
              </Typography>
              <Typography sx={{ fontSize: textSize.sm, color: tokens.color.ink2 }}>
                {t('matchPage.reelLead')}
              </Typography>
              {teams.length > 1 && (
                <SegmentedControl
                  look="chips"
                  size="small"
                  label={t('matchPage.reelTeam')}
                  value={String(pick)}
                  onChange={(id) =>
                    setPick(teams.find((x) => String(x.teamId) === id)?.teamId ?? pick)
                  }
                  options={teams.map((x) => ({
                    value: String(x.teamId),
                    label: t('matchPage.teamHighlights', { team: x.team ?? x.teamId }),
                  }))}
                />
              )}
              <Box
                component="ol"
                aria-label={t('matchPage.inThisReel')}
                sx={{
                  listStyle: 'none',
                  p: 0,
                  m: 0,
                  maxHeight: 320,
                  overflowY: 'auto',
                  borderRadius: radii.md,
                  bgcolor: tokens.color.paper3,
                }}
              >
                {chapters.map((c, i) => (
                  <Box
                    component="li"
                    key={c.highlightId}
                    sx={{ '& + &': { borderTop: `1px solid ${tokens.color.rule}` } }}
                  >
                    <ButtonBase
                      onClick={() => player.current?.seek(c.at ?? 0)}
                      sx={{
                        width: '100%',
                        display: 'grid',
                        gridTemplateColumns: 'auto minmax(0, 1fr)',
                        gap: 1.5,
                        px: 2,
                        py: 1,
                        textAlign: 'left',
                        bgcolor: i === current ? tokens.color.rule : 'transparent',
                      }}
                    >
                      <Box
                        component="span"
                        sx={{ ...mono, fontSize: textSize.xs, color: tokens.color.muted }}
                      >
                        {clock(c.at ?? 0)}
                      </Box>
                      <Box component="span" sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                          {c.playerName}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{ color: tokens.color.muted }}
                          noWrap
                          component="div"
                        >
                          {kindLabel(t, c.kind, c.clutch)} ·{' '}
                          {t('highlights.roundN', { n: c.round })}
                        </Typography>
                      </Box>
                    </ButtonBase>
                  </Box>
                ))}
              </Box>
              <Box
                component={RouterLink}
                to={watchTeamReelPath(matchSlug, pick ?? '')}
                sx={{ fontSize: textSize.sm, color: tokens.color.accent }}
              >
                {t('matchPage.openReel')}
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {board &&
        shownBoard &&
        board.team1.length + board.team2.length > 0 &&
        section(
          t('matchPage.scoreboard'),
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {(['team1', 'team2'] as const).map((side) => (
              <Box key={side} sx={{ overflowX: 'auto' }}>
                <Box
                  component="table"
                  sx={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: '0.9375rem',
                    '& th': {
                      fontSize: '0.75rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: tokens.color.muted,
                      fontWeight: 600,
                      textAlign: 'right',
                      p: 1,
                      whiteSpace: 'nowrap',
                    },
                    '& td': {
                      p: '10px 8px',
                      textAlign: 'right',
                      borderTop: `1px solid ${tokens.color.rule}`,
                      whiteSpace: 'nowrap',
                      ...mono,
                    },
                    '& th:first-of-type, & td:first-of-type': {
                      textAlign: 'left',
                      fontFamily: 'inherit',
                      whiteSpace: 'normal',
                      overflowWrap: 'anywhere',
                    },
                  }}
                >
                  <thead>
                    <tr>
                      <th scope="col">
                        {match[side]?.id ? (
                          <Box
                            component={RouterLink}
                            to={links.team(match[side].id)}
                            sx={{
                              color: 'inherit',
                              textDecoration: 'none',
                              '&:hover': { textDecoration: 'underline' },
                            }}
                          >
                            {teamName(side)}
                          </Box>
                        ) : (
                          teamName(side)
                        )}
                      </th>
                      <th scope="col">K</th>
                      <th scope="col">D</th>
                      <Box component="th" scope="col" sx={opt}>
                        A
                      </Box>
                      <th scope="col">ADR</th>
                      <Box component="th" scope="col" sx={opt}>
                        HS %
                      </Box>
                      <Box component="th" scope="col" sx={opt}>
                        KAST
                      </Box>
                      <Box component="th" scope="col" sx={opt}>
                        {t('matchPage.openingKills')}
                      </Box>
                      <th scope="col">{t('matchPage.rating')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownBoard[side].map((l) => {
                      const r = rating(l);
                      return (
                        <tr key={`${side}-${l.playerId}`}>
                          <td>
                            <Box
                              component={RouterLink}
                              to={`/player/${l.playerId}`}
                              sx={{
                                color: 'inherit',
                                textDecoration: 'none',
                                fontWeight: 600,
                                '&:hover': { color: tokens.color.accent },
                              }}
                            >
                              {l.name}
                            </Box>
                          </td>
                          <td>{l.kills}</td>
                          <td>{l.deaths}</td>
                          <Box component="td" sx={opt}>
                            {l.assists}
                          </Box>
                          <Box
                            component="td"
                            sx={{ color: l.adr >= 100 ? tokens.color.accent : undefined }}
                          >
                            {fmtNum(l.adr, 1)}
                          </Box>
                          <Box component="td" sx={opt}>
                            {l.hsPercent}
                          </Box>
                          <Box component="td" sx={opt}>
                            {l.kast}%
                          </Box>
                          <Box component="td" sx={opt}>
                            {l.entryKills}
                          </Box>
                          <Box
                            component="td"
                            sx={{
                              fontWeight: 600,
                              color:
                                r >= 1.1
                                  ? tokens.color.live
                                  : r < 0.9
                                    ? tokens.color.ink2
                                    : undefined,
                            }}
                          >
                            {fmtNum(r, 2)}
                          </Box>
                        </tr>
                      );
                    })}
                  </tbody>
                </Box>
              </Box>
            ))}
          </Box>,
          'match-page-scoreboard',
          mapsInBoard.length > 1 ? (
            <SegmentedControl
              size="small"
              label={t('matchPage.scoreboardMap')}
              value={String(boardMap)}
              onChange={(key) => setBoardMap(key === 'all' ? 'all' : Number(key))}
              options={(
                ['all', ...mapsInBoard.map((m) => m.mapNumber)] as Array<'all' | number>
              ).map((key) => {
                const mapRow =
                  key === 'all' ? null : match.mapScores.find((m) => m.mapNumber === key);
                return {
                  value: String(key),
                  label:
                    key === 'all'
                      ? t('matchPage.allMaps')
                      : mapRow?.map
                        ? mapLabel(t, mapRow.map, 0)
                        : t('seriesMaps.mapN', { n: key + 1 }),
                };
              })}
            />
          ) : undefined
        )}

      {(clips.length > 0 || recording) &&
        section(
          t('matchPage.highlights'),
          <>
            {recording && progress && (
              <Box sx={{ maxWidth: 520 }} data-testid="match-page-clip-progress">
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.75 }}>
                  <Typography variant="body2" sx={{ color: tokens.color.ink2 }}>
                    {t('matchPage.recordingClips')}
                  </Typography>
                  <Typography variant="body2" sx={{ ...mono, fontVariantNumeric: 'tabular-nums' }}>
                    {t('matchPage.clipsDone', { done: progress.done, total: progress.total })}
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={progress.total ? (progress.done / progress.total) * 100 : 0}
                  aria-label={t('matchPage.recordingClips')}
                  sx={{ height: 6, borderRadius: radii.pill }}
                />
                {Object.values(live).length > 0 && (
                  <Box
                    component="ul"
                    sx={{ listStyle: 'none', p: 0, m: 0, mt: 1, display: 'grid', gap: 0.25 }}
                    data-testid="match-page-recording-now"
                  >
                    {Object.values(live)
                      .sort((a, b) =>
                        a.recorder.localeCompare(b.recorder, undefined, { numeric: true })
                      )
                      .map((r) => (
                        <Typography
                          key={r.recorder}
                          component="li"
                          variant="caption"
                          sx={{ color: tokens.color.muted }}
                          noWrap
                        >
                          {[
                            r.recorder,
                            t(`recorderProgress.step.${r.step}`, { defaultValue: r.step }),
                            r.detail,
                            typeof r.done === 'number' && r.total
                              ? t('recorderProgress.clipOf', {
                                  n: Math.min(r.done + 1, r.total),
                                  total: r.total,
                                })
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Typography>
                      ))}
                  </Box>
                )}
              </Box>
            )}
            <MatchClipGrid clips={clips} />
          </>,
          'match-page-highlights',
          <Box
            component={RouterLink}
            to={libraryPath({ match: matchSlug })}
            sx={{ color: tokens.color.accent, fontSize: textSize.sm, textDecoration: 'none' }}
            data-testid="match-page-library"
          >
            {t('library.matchHighlights')}
          </Box>
        )}
    </Box>
  );
}
