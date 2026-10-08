/**
 * CS2's part of a finished match's public page (`matchPanels.publicView`):
 * the team reels in the platform's player (music, crowd, chapters), the
 * scoreboard over the whole match from the demos, and every highlight clip.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import {
  api,
  fontDisplay,
  HighlightPlayer,
  mono,
  radii,
  textSize,
  tokens,
  useModuleTranslation,
  VideoThumb,
  type HighlightPlayerHandle,
  type MusicTrack,
} from '../../../module-sdk';
import type { MatchPublicPanelProps } from '../../types';
import {
  clock,
  kindLabel,
  mapLabel,
  playTitle,
  watchClipPath,
  watchTeamReelPath,
  type Chapter,
} from './data';

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
  kills: number;
  deaths: number;
  assists: number;
  adr: number;
  hsPercent: number;
  kast: number;
  entryKills: number;
}

interface MatchClip {
  id: number;
  playerId: string;
  playerName: string;
  kind: string;
  title: string;
  round: number;
  mapNumber: number;
  map: string | null;
  video: string;
}

export function MatchPublicPanel({ matchSlug, match }: MatchPublicPanelProps) {
  const { t } = useModuleTranslation('cs2');
  const [teams, setTeams] = useState<TeamReelRow[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [reel, setReel] = useState<TeamReel | null>(null);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [board, setBoard] = useState<{ team1: Line[]; team2: Line[] } | null>(null);
  const [clips, setClips] = useState<MatchClip[]>([]);
  const [time, setTime] = useState(0);
  const player = useRef<HighlightPlayerHandle>(null);
  const enc = encodeURIComponent;

  useEffect(() => {
    let cancelled = false;
    void api
      .get<{ teams: TeamReelRow[] }>(`/api/game/cs2/matches/${enc(matchSlug)}/reels`)
      .then((r) => {
        if (cancelled) return;
        const done = (r.teams ?? []).filter((x) => x.status === 'done' && x.video);
        setTeams(done);
        // The winners' reel first.
        const winner = match.winnerSide ? match[match.winnerSide]?.id : null;
        setPick((done.find((x) => x.teamId === winner) ?? done[0])?.teamId ?? null);
      })
      .catch(() => undefined);
    void api
      .get<{ team1: Line[]; team2: Line[] }>(`/api/game/cs2/matches/${enc(matchSlug)}/scoreboard`)
      .then((r) => !cancelled && setBoard({ team1: r.team1, team2: r.team2 }))
      .catch(() => undefined);
    void api
      .get<{ clips: MatchClip[] }>(`/api/game/cs2/matches/${enc(matchSlug)}/highlights`)
      .then((r) => !cancelled && setClips(r.clips))
      .catch(() => undefined);
    void api
      .get<{ tracks: MusicTrack[] }>('/api/game/cs2/music')
      .then((r) => !cancelled && setTracks(r.tracks))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per match
  }, [matchSlug]);

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

  const section = (title: string, children: ReactNode, testid: string) => (
    <Box component="section" sx={{ mt: 5 }} data-testid={testid}>
      <Typography variant="h5" component="h2" sx={{ fontWeight: 700, mb: 2 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );

  const teamName = (side: 'team1' | 'team2') => match[side]?.name ?? '';

  return (
    <Box>
      {reel && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1.8fr) minmax(0, 1fr)' },
            gap: 3,
            alignItems: 'start',
          }}
          data-testid="match-page-reel"
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
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
              {t('highlights.watch.teamReel', { team: reel.team ?? '' })}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t('matchPage.reelLead')}
            </Typography>
            {teams.length > 1 && (
              <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
                {teams.map((x) => (
                  <ButtonBase
                    key={x.teamId}
                    onClick={() => setPick(x.teamId)}
                    aria-pressed={x.teamId === pick}
                    sx={{
                      px: 1.5,
                      py: 0.75,
                      borderRadius: radii.pill,
                      border: 1,
                      borderColor: x.teamId === pick ? tokens.color.accent : 'divider',
                      fontSize: textSize.sm,
                      fontWeight: 600,
                    }}
                  >
                    {x.team ?? x.teamId}
                  </ButtonBase>
                ))}
              </Stack>
            )}
            <Box
              component="ol"
              aria-label={t('matchPage.inThisReel')}
              sx={{
                listStyle: 'none',
                p: 0,
                m: 0,
                mt: 2,
                maxHeight: 320,
                overflowY: 'auto',
                border: 1,
                borderColor: 'divider',
                borderRadius: radii.lg,
              }}
            >
              {chapters.map((c, i) => (
                <Box
                  component="li"
                  key={c.highlightId}
                  sx={{ '& + &': { borderTop: 1, borderColor: 'divider' } }}
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
                      bgcolor: i === current ? 'background.surface3' : 'transparent',
                    }}
                  >
                    <Box
                      component="span"
                      sx={{ ...mono, fontSize: textSize.xs, color: 'text.secondary' }}
                    >
                      {clock(c.at ?? 0)}
                    </Box>
                    <Box component="span" sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                        {c.playerName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap component="div">
                        {kindLabel(t, c.kind, c.clutch)} · {t('highlights.roundN', { n: c.round })}
                      </Typography>
                    </Box>
                  </ButtonBase>
                </Box>
              ))}
            </Box>
            <ButtonBase
              component={RouterLink}
              to={watchTeamReelPath(matchSlug, pick ?? '')}
              sx={{ mt: 1.5, fontSize: textSize.sm, color: 'text.secondary' }}
            >
              {t('matchPage.openReel')}
            </ButtonBase>
          </Box>
        </Box>
      )}

      {board &&
        board.team1.length + board.team2.length > 0 &&
        section(
          t('matchPage.scoreboard'),
          <Box
            sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: radii.lg }}
          >
            <Box
              component="table"
              sx={{
                width: '100%',
                borderCollapse: 'collapse',
                fontVariantNumeric: 'tabular-nums',
                fontSize: textSize.sm,
                '& th, & td': {
                  px: 2,
                  py: 1,
                  textAlign: 'right',
                  whiteSpace: 'nowrap',
                  borderBottom: 1,
                  borderColor: 'divider',
                },
                '& th:first-of-type, & td:first-of-type': { textAlign: 'left' },
                '& th': {
                  ...mono,
                  fontSize: textSize.xs,
                  color: 'text.secondary',
                  fontWeight: 500,
                },
              }}
            >
              <thead>
                <tr>
                  <th>{t('matchPage.player')}</th>
                  <th>K</th>
                  <th>D</th>
                  <th>A</th>
                  <th>+/−</th>
                  <th>ADR</th>
                  <th>HS %</th>
                  <th>KAST</th>
                  <th>{t('matchPage.openingKills')}</th>
                </tr>
              </thead>
              <tbody>
                {(['team1', 'team2'] as const).flatMap((side) => [
                  <Box
                    component="tr"
                    key={side}
                    sx={{
                      '& td': {
                        ...mono,
                        fontSize: textSize.xs,
                        bgcolor: 'background.surface2',
                        color: 'text.secondary',
                        textAlign: 'left !important',
                      },
                    }}
                  >
                    <td colSpan={9}>{teamName(side)}</td>
                  </Box>,
                  ...board[side].map((l) => {
                    const diff = l.kills - l.deaths;
                    return (
                      <tr key={`${side}-${l.playerId}`}>
                        <td>
                          <Box
                            component={RouterLink}
                            to={`/player/${l.playerId}`}
                            sx={{ color: 'inherit', textDecoration: 'none', fontWeight: 600 }}
                          >
                            {l.name}
                          </Box>
                        </td>
                        <td>{l.kills}</td>
                        <td>{l.deaths}</td>
                        <td>{l.assists}</td>
                        <Box
                          component="td"
                          sx={{
                            color:
                              diff > 0
                                ? tokens.color.live
                                : diff < 0
                                  ? 'text.secondary'
                                  : undefined,
                          }}
                        >
                          {diff > 0 ? `+${diff}` : diff}
                        </Box>
                        <Box
                          component="td"
                          sx={{
                            color: l.adr >= 100 ? tokens.color.accent : undefined,
                            fontWeight: l.adr >= 100 ? 600 : undefined,
                          }}
                        >
                          {l.adr.toFixed(1)}
                        </Box>
                        <td>{l.hsPercent}</td>
                        <td>{l.kast}%</td>
                        <td>{l.entryKills}</td>
                      </tr>
                    );
                  }),
                ])}
              </tbody>
            </Box>
          </Box>,
          'match-page-scoreboard'
        )}

      {clips.length > 0 &&
        section(
          t('matchPage.highlights'),
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
              gap: 2,
            }}
          >
            {clips.map((c) => (
              <Box
                key={c.id}
                component={RouterLink}
                to={watchClipPath(c.id)}
                sx={{
                  color: 'inherit',
                  textDecoration: 'none',
                  display: 'grid',
                  gap: 0.75,
                  minWidth: 0,
                }}
              >
                <Box
                  sx={{
                    position: 'relative',
                    aspectRatio: '16 / 9',
                    maxWidth: '100%',
                    borderRadius: radii.md,
                    overflow: 'hidden',
                    bgcolor: 'background.surface3',
                    border: 1,
                    borderColor: 'divider',
                  }}
                >
                  <VideoThumb src={c.video} at={4} />
                  <Box
                    component="span"
                    sx={{
                      position: 'absolute',
                      left: 8,
                      top: 8,
                      px: 1,
                      py: 0.25,
                      borderRadius: radii.pill,
                      bgcolor: tokens.color.accent,
                      color: tokens.color.accentInk,
                      fontFamily: fontDisplay,
                      fontWeight: 700,
                      fontSize: textSize.xs,
                    }}
                  >
                    {kindLabel(t, c.kind)}
                  </Box>
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                  {c.playerName}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  {playTitle(c.title)} · {mapLabel(t, c.map, c.mapNumber)} ·{' '}
                  {t('highlights.roundN', { n: c.round })}
                </Typography>
              </Box>
            ))}
          </Box>,
          'match-page-highlights'
        )}
    </Box>
  );
}
