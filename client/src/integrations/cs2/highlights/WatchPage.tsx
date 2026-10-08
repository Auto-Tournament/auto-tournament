import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Box, ButtonBase, CircularProgress, Container } from '@mui/material';
import {
  api,
  fontDisplay,
  links,
  mono,
  openMatchDetails,
  pageTitle,
  radii,
  textSize,
  tokens,
  useModuleTranslation,
} from '../../../module-sdk';
import { analysisPath } from '../demos/paths';
import {
  clock,
  kindLabel,
  mapLabel,
  playTitle,
  teamsLabel,
  watchClipPath,
  watchMatchReelPath,
  watchTeamReelPath,
  watchReelPath,
  type Chapter,
  type Clip,
  type ClipMarkers,
  type MatchRef,
  type PlayerHighlights,
} from './data';
import {
  HighlightPlayer,
  PlayerAvatar,
  thumbAt,
  VideoThumb,
  type HighlightPlayerHandle,
  type MusicTrack,
} from '../../../module-sdk';

/** Someone with highlights on the map (the API's watchRelated). */
interface RelatedPlayer {
  playerId: string;
  name: string;
  avatarUrl: string | null;
  clips: number;
  reel: boolean;
}

/** Another match reel to watch. */
interface RelatedReel {
  kind: 'match' | 'team';
  teamId?: string;
  team?: string | null;
  matchSlug: string;
  mapNumber: number;
  map: string | null;
  team1: string | null;
  team2: string | null;
  video: string;
  clips: number | null;
}

const sectionTitle = {
  m: 0,
  ...mono,
  fontSize: '0.8125rem',
  fontWeight: 500,
  color: tokens.color.muted,
} as const;

/** A reel's players in the order it shows them; for a single clip, everyone on the map. */
function inReelOrder(players: RelatedPlayer[], chapters: Chapter[]): RelatedPlayer[] {
  if (!chapters.length) return [...players].sort((a, b) => b.clips - a.clips);
  // A reel: only its own players, in its order, with how many plays they have in it.
  const first = new Map<string, number>();
  const count = new Map<string, number>();
  chapters.forEach((c, i) => {
    if (!first.has(c.playerId)) first.set(c.playerId, i);
    count.set(c.playerId, (count.get(c.playerId) ?? 0) + 1);
  });
  return players
    .filter((p) => first.has(p.playerId))
    .map((p) => ({ ...p, clips: count.get(p.playerId) ?? p.clips }))
    .sort((a, b) => first.get(a.playerId)! - first.get(b.playerId)!);
}

/** What one watch page shows, whatever kind of video it is. */
interface Watchable {
  video: string;
  title: string;
  sub: string;
  markers: ClipMarkers | null;
  chapters: Chapter[];
  match: MatchRef | null;
  mapNumber: number | null;
  round: number | null;
  playerId: string | null;
  /** The file name a download is saved as. */
  file: string;
  /** A reel's crowd track, played beside it. */
  crowd: string | null;
}

const pill = {
  height: 40,
  px: 2,
  borderRadius: radii.pill,
  border: `1px solid ${tokens.color.rule}`,
  display: 'inline-flex',
  alignItems: 'center',
  color: tokens.color.ink2,
  textDecoration: 'none',
  fontSize: textSize.sm,
  whiteSpace: 'nowrap',
  '&:hover': { color: tokens.color.ink, borderColor: tokens.color.ink2 },
  '&.Mui-focusVisible, &:focus-visible': {
    outline: `2px solid ${tokens.color.accent}`,
    outlineOffset: 2,
  },
} as const;

/**
 * One highlight video on its own page (the drafts' player board): our
 * player, what it is, links to the match and the round's 2D replay, and
 * beside it the reel's chapters (or, for a single clip, more of the player's).
 *
 * `/watch/clip/:id`, `/watch/reel/:match/:map/:player`,
 * `/watch/match/:match/:map`, `/watch/tournament/:id`.
 */
export function WatchPage() {
  const params = useParams();
  const parts = (params['*'] ?? '').split('/').filter(Boolean).map(decodeURIComponent);
  const key = parts.join('/');
  const { t } = useModuleTranslation('cs2');
  const [item, setItem] = useState<{ key: string; w: Watchable } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [more, setMore] = useState<Clip[]>([]);
  const [time, setTime] = useState(0);
  const player = useRef<HighlightPlayerHandle>(null);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);

  // Reels play music beside them (not part of the video; a download can mix one in).
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ tracks: MusicTrack[] }>('/api/game/cs2/music')
      .then((res) => !cancelled && setTracks(res.tracks))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const [kind, a, b, c] = parts;
    const done = (w: Watchable) => !cancelled && setItem({ key, w });
    const fail = () => !cancelled && setFailed(key);
    const enc = encodeURIComponent;
    if (kind === 'clip') {
      api
        .get<{ clip: Clip }>(`/api/game/cs2/watch/clip/${enc(a ?? '')}`)
        .then(({ clip }) =>
          done({
            video: clip.video!,
            title: `${clip.playerName} · ${playTitle(clip.title)}`,
            sub: [
              teamsLabel(clip.match),
              mapLabel(t, clip.map, clip.mapNumber),
              t('highlights.roundN', { n: clip.round }),
              clip.match.tournament,
            ]
              .filter(Boolean)
              .join(' · '),
            markers: clip.markers,
            chapters: [],
            match: clip.match,
            mapNumber: clip.mapNumber,
            round: clip.round,
            playerId: clip.playerId,
            file: `${clip.playerName}-${clip.kind}-${clip.id}.mp4`,
            crowd: null,
          })
        )
        .catch(fail);
    } else if (kind === 'reel') {
      api
        .get<{
          reel: {
            video: string;
            crowd?: string | null;
            map: string | null;
            mapNumber: number;
            chapters: Chapter[];
            match: MatchRef;
            playerName: string;
          };
        }>(`/api/game/cs2/watch/reel/${enc(a ?? '')}/${enc(b ?? '')}/${enc(c ?? '')}`)
        .then(({ reel }) =>
          done({
            video: reel.video,
            title: t('highlights.watch.playerReel', {
              name: reel.playerName,
              map: mapLabel(t, reel.map, reel.mapNumber),
            }),
            sub: [teamsLabel(reel.match), reel.match.tournament].filter(Boolean).join(' · '),
            markers: null,
            chapters: reel.chapters,
            match: reel.match,
            mapNumber: reel.mapNumber,
            round: null,
            playerId: c ?? null,
            file: `${reel.playerName}-reel.mp4`,
            crowd: reel.crowd ?? null,
          })
        )
        .catch(fail);
    } else if (kind === 'match') {
      api
        .get<{
          reel: {
            video: string;
            crowd?: string | null;
            map: string | null;
            mapNumber: number;
            chapters: Chapter[];
            match: MatchRef;
          };
        }>(`/api/game/cs2/watch/match/${enc(a ?? '')}/${enc(b ?? '')}`)
        .then(({ reel }) =>
          done({
            video: reel.video,
            title: t('highlights.watch.matchReel', { map: mapLabel(t, reel.map, reel.mapNumber) }),
            sub: [teamsLabel(reel.match), reel.match.tournament].filter(Boolean).join(' · '),
            markers: null,
            chapters: reel.chapters,
            match: reel.match,
            mapNumber: reel.mapNumber,
            round: null,
            playerId: null,
            file: 'match-reel.mp4',
            crowd: reel.crowd ?? null,
          })
        )
        .catch(fail);
    } else if (kind === 'team') {
      api
        .get<{
          reel: {
            video: string;
            crowd?: string | null;
            team: string | null;
            chapters: Chapter[];
            match: MatchRef;
          };
        }>(`/api/game/cs2/watch/team/${enc(a ?? '')}/${enc(b ?? '')}`)
        .then(({ reel }) =>
          done({
            video: reel.video,
            title: t('highlights.watch.teamReel', { team: reel.team ?? '' }),
            sub: [teamsLabel(reel.match), reel.match.tournament].filter(Boolean).join(' · '),
            markers: null,
            chapters: reel.chapters,
            match: reel.match,
            mapNumber: null,
            round: null,
            playerId: null,
            file: `${reel.team ?? 'team'}-highlights.mp4`,
            crowd: reel.crowd ?? null,
          })
        )
        .catch(fail);
    } else if (kind === 'tournament') {
      api
        .get<{ reel: { video: string; crowd?: string | null; chapters: Chapter[] } }>(
          `/api/game/cs2/watch/tournament/${enc(a ?? '')}`
        )
        .then(({ reel }) =>
          done({
            video: reel.video,
            title: t('highlights.watch.tournamentReel'),
            sub: t('highlights.watch.plays', { count: reel.chapters.length }),
            markers: null,
            chapters: reel.chapters,
            match: null,
            mapNumber: null,
            round: null,
            playerId: null,
            file: 'tournament-reel.mp4',
            crowd: reel.crowd ?? null,
          })
        )
        .catch(fail);
    } else {
      fail();
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `parts` is `key` split
  }, [key, t]);

  const w = item?.key === key ? item.w : null;

  // Under the video: the players on this map and more reels to watch.
  const [related, setRelated] = useState<{
    key: string;
    players: RelatedPlayer[];
    reels: RelatedReel[];
  } | null>(null);
  useEffect(() => {
    if (!w) return;
    const kind = parts[0];
    const q =
      kind === 'tournament'
        ? `tournament=${encodeURIComponent(parts[1] ?? '')}`
        : w.match && w.mapNumber !== null
          ? `match=${encodeURIComponent(w.match.slug)}&map=${w.mapNumber}`
          : w.match
            ? `match=${encodeURIComponent(w.match.slug)}`
            : null;
    if (!q) return;
    let cancelled = false;
    api
      .get<{ players: RelatedPlayer[]; reels: RelatedReel[] }>(`/api/game/cs2/watch/related?${q}`)
      .then((res) => !cancelled && setRelated({ key, players: res.players, reels: res.reels }))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `parts` is `key` split
  }, [w, key]);
  const rel = related?.key === key ? related : null;

  // A single clip: more of the player's beside it.
  useEffect(() => {
    if (!w?.playerId || w.chapters.length > 0) {
      setMore([]);
      return;
    }
    let cancelled = false;
    api
      .get<PlayerHighlights>(`/api/game/cs2/players/${encodeURIComponent(w.playerId)}/highlights`)
      .then(
        (res) =>
          !cancelled &&
          setMore(
            res.highlights.filter((c) => c.status === 'done' && c.video !== w.video).slice(0, 5)
          )
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [w]);

  useEffect(() => {
    if (w) document.title = pageTitle(w.title);
  }, [w]);

  if (failed === key) {
    return (
      <Container maxWidth="lg" sx={{ py: 6, color: tokens.color.muted }}>
        {t('highlights.watch.missing')}
      </Container>
    );
  }
  if (!w) {
    return (
      <Container maxWidth="lg" sx={{ py: 8, display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label={t('highlights.loading')} />
      </Container>
    );
  }

  // The chapter playing: the last one started.
  const current = w.chapters.reduce(
    (at, c, i) => (c.at !== null && c.at <= time + 0.05 ? i : at),
    0
  );
  const side = w.chapters.length > 0 || more.length > 0;

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2, md: 5 } }} data-testid="cs2-watch">
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0,1fr)',
            md: side ? 'minmax(0,1fr) 300px' : 'minmax(0,1fr)',
          },
          gap: 2.5,
          alignItems: 'start',
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <HighlightPlayer
            ref={player}
            src={w.video}
            label={w.title}
            markers={w.markers}
            chapterStarts={w.chapters.flatMap((c) => (c.at === null ? [] : [c.at]))}
            downloadName={w.file}
            crowd={w.crowd}
            music={
              w.chapters.length > 0 && tracks.length > 0
                ? { tracks, introEnd: Math.max(0, w.chapters[0]?.at ?? 0) }
                : null
            }
            autoPlay
            onTime={setTime}
          />
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
              <Box
                component="h1"
                sx={{
                  m: 0,
                  fontFamily: fontDisplay,
                  fontSize: { xs: '1.25rem', md: '1.375rem' },
                  fontWeight: 600,
                  overflowWrap: 'anywhere',
                }}
              >
                {w.title}
              </Box>
              <Box sx={{ fontSize: textSize.sm, color: tokens.color.muted }}>{w.sub}</Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {w.match && (
                <ButtonBase
                  onClick={() => void openMatchDetails(w.match!.slug).catch(() => undefined)}
                  sx={pill}
                >
                  {t('highlights.watch.openMatch')}
                </ButtonBase>
              )}
              {w.match && w.mapNumber !== null && (
                <Box
                  component={RouterLink}
                  to={`${analysisPath(w.match.slug, w.mapNumber)}${w.round ? `?round=${w.round}` : ''}`}
                  sx={pill}
                >
                  {t(w.round ? 'highlights.watch.replayRound' : 'highlights.watch.analysis')}
                </Box>
              )}
              {w.playerId && (
                <Box component={RouterLink} to={links.playerProfile(w.playerId)} sx={pill}>
                  {t('highlights.watch.profile')}
                </Box>
              )}
            </Box>
          </Box>
        </Box>

        {side && (
          // Beside the player, as tall as it and its title (the list scrolls);
          // under it on a phone, a few rows tall.
          <Box
            component="aside"
            sx={{ position: 'relative', alignSelf: { md: 'stretch' }, minHeight: { md: 240 } }}
          >
            <Box
              sx={{
                position: { md: 'absolute' },
                inset: { md: 0 },
                display: 'flex',
                flexDirection: 'column',
                gap: 1.25,
              }}
            >
              <Box
                component="h2"
                sx={{
                  m: 0,
                  ...mono,
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  color: tokens.color.muted,
                }}
              >
                {w.chapters.length > 0
                  ? t('highlights.watch.inThisReel')
                  : t('highlights.watch.more')}
              </Box>
              <Box
                data-testid="cs2-watch-list"
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.25,
                  overflowY: 'auto',
                  overscrollBehavior: 'contain',
                  maxHeight: { xs: 420, md: 'none' },
                  flex: { md: 1 },
                  minHeight: 0,
                  pr: 0.5,
                }}
              >
                {w.chapters.map((c, i) => (
                  <ButtonBase
                    key={`${c.highlightId}-${i}`}
                    disabled={c.at === null}
                    onClick={() => {
                      if (c.at === null) return;
                      player.current?.seek(c.at);
                      player.current?.play();
                    }}
                    aria-current={i === current ? 'true' : undefined}
                    sx={{
                      display: 'flex',
                      gap: 1.25,
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      p: 1,
                      borderRadius: '14px',
                      border: `1px solid ${i === current ? tokens.color.accent : tokens.color.rule}`,
                      bgcolor: tokens.color.paper2,
                      color: tokens.color.ink,
                      textAlign: 'left',
                      '&:hover': { bgcolor: tokens.color.paper3 },
                      '&.Mui-focusVisible': {
                        outline: `2px solid ${tokens.color.accent}`,
                        outlineOffset: 2,
                      },
                    }}
                  >
                    <Box
                      sx={{
                        position: 'relative',
                        width: 104,
                        flex: 'none',
                        aspectRatio: '16 / 9',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        bgcolor: tokens.color.paper3,
                      }}
                    >
                      <VideoThumb src={`/api/game/cs2/highlights/${c.highlightId}.mp4`} at={1.5} />
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
                      <Box
                        sx={{ fontWeight: 600, fontSize: textSize.sm, overflowWrap: 'anywhere' }}
                      >
                        {c.playerName} · {kindLabel(t, c.kind, c.clutch)}
                      </Box>
                      <Box sx={{ fontSize: '0.75rem', color: tokens.color.muted }}>
                        {[
                          c.map ? mapLabel(t, c.map, 0) : null,
                          t('highlights.roundN', { n: c.round }),
                          c.at !== null ? clock(c.at) : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Box>
                    </Box>
                  </ButtonBase>
                ))}
                {more.map((c) => (
                  <Box
                    key={c.id}
                    component={RouterLink}
                    to={watchClipPath(c.id)}
                    sx={{
                      display: 'flex',
                      gap: 1.25,
                      alignItems: 'center',
                      p: 1,
                      borderRadius: '14px',
                      border: `1px solid ${tokens.color.rule}`,
                      bgcolor: tokens.color.paper2,
                      color: tokens.color.ink,
                      textDecoration: 'none',
                      '&:hover': { bgcolor: tokens.color.paper3 },
                      '&:focus-visible': {
                        outline: `2px solid ${tokens.color.accent}`,
                        outlineOffset: 2,
                      },
                    }}
                  >
                    <Box
                      sx={{
                        position: 'relative',
                        width: 104,
                        flex: 'none',
                        aspectRatio: '16 / 9',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        bgcolor: tokens.color.paper3,
                      }}
                    >
                      <VideoThumb src={c.video!} at={thumbAt(c.markers)} />
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
                      <Box
                        sx={{ fontWeight: 600, fontSize: textSize.sm, overflowWrap: 'anywhere' }}
                      >
                        {playTitle(c.title)}
                      </Box>
                      <Box sx={{ fontSize: '0.75rem', color: tokens.color.muted }}>
                        {[
                          mapLabel(t, c.map, c.mapNumber),
                          t('highlights.roundN', { n: c.round }),
                        ].join(' · ')}
                      </Box>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        )}
      </Box>

      {rel && (rel.players.length > 0 || rel.reels.length > 0) && (
        <Box
          sx={{ display: 'flex', flexDirection: 'column', gap: 4, mt: { xs: 4, md: 5 } }}
          data-testid="cs2-watch-related"
        >
          {rel.players.length > 0 && (
            <Box component="section" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box component="h2" sx={sectionTitle}>
                {t('highlights.watch.players')}
              </Box>
              <Box
                component="ul"
                sx={{
                  listStyle: 'none',
                  m: 0,
                  p: 0,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: 1.25,
                }}
              >
                {inReelOrder(rel.players, w.chapters).map((p) => {
                  const onScreen = w.chapters[current]?.playerId === p.playerId;
                  const to =
                    p.reel && w.match && w.mapNumber !== null
                      ? watchReelPath(w.match.slug, w.mapNumber, p.playerId)
                      : links.playerProfile(p.playerId);
                  return (
                    <Box component="li" key={p.playerId} sx={{ minWidth: 0 }}>
                      <Box
                        component={RouterLink}
                        to={to}
                        aria-current={onScreen ? 'true' : undefined}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.25,
                          p: 1.25,
                          borderRadius: '14px',
                          border: `1px solid ${onScreen ? tokens.color.accent : tokens.color.rule}`,
                          bgcolor: tokens.color.paper2,
                          color: tokens.color.ink,
                          textDecoration: 'none',
                          transition: 'border-color 200ms',
                          '&:hover': { bgcolor: tokens.color.paper3 },
                          '&:focus-visible': {
                            outline: `2px solid ${tokens.color.accent}`,
                            outlineOffset: 2,
                          },
                        }}
                      >
                        <PlayerAvatar
                          id={p.playerId}
                          name={p.name}
                          avatarUrl={p.avatarUrl}
                          size={36}
                        />
                        <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <Box
                            sx={{
                              fontWeight: 600,
                              fontSize: textSize.sm,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {p.name}
                          </Box>
                          <Box
                            sx={{
                              fontSize: '0.75rem',
                              color: tokens.color.muted,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {p.reel
                              ? t('highlights.watch.theirReel', { count: p.clips })
                              : t('highlights.watch.clips', { count: p.clips })}
                          </Box>
                        </Box>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}
          {rel.reels.length > 0 && (
            <Box component="section" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box component="h2" sx={sectionTitle}>
                {t('highlights.watch.moreReels')}
              </Box>
              <Box
                component="ul"
                sx={{
                  listStyle: 'none',
                  m: 0,
                  p: 0,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))',
                  gap: 2,
                }}
              >
                {rel.reels
                  .filter(
                    (r) => !(r.kind === 'team' && parts[0] === 'team' && parts[2] === r.teamId)
                  )
                  .map((r) => (
                    <Box
                      component="li"
                      key={`${r.kind}-${r.matchSlug}-${r.teamId ?? r.mapNumber}`}
                      sx={{ minWidth: 0 }}
                    >
                      <Box
                        component={RouterLink}
                        to={
                          r.kind === 'team'
                            ? watchTeamReelPath(r.matchSlug, r.teamId!)
                            : watchMatchReelPath(r.matchSlug, r.mapNumber)
                        }
                        sx={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 1,
                          color: tokens.color.ink,
                          textDecoration: 'none',
                          '&:hover .thumb': { borderColor: tokens.color.ink2 },
                          '&:focus-visible': {
                            outline: `2px solid ${tokens.color.accent}`,
                            outlineOffset: 2,
                            borderRadius: '14px',
                          },
                        }}
                      >
                        <Box
                          className="thumb"
                          sx={{
                            position: 'relative',
                            aspectRatio: '16 / 9',
                            maxWidth: '100%',
                            borderRadius: '14px',
                            overflow: 'hidden',
                            bgcolor: tokens.color.paper3,
                            border: `1px solid ${tokens.color.rule}`,
                          }}
                        >
                          <VideoThumb src={r.video} at={8} />
                        </Box>
                        <Box
                          sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}
                        >
                          <Box
                            sx={{
                              fontWeight: 600,
                              fontSize: textSize.sm,
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {r.kind === 'team'
                              ? t('highlights.watch.teamReel', { team: r.team ?? '' })
                              : t('highlights.watch.matchReel', {
                                  map: mapLabel(t, r.map, r.mapNumber),
                                })}
                          </Box>
                          <Box sx={{ fontSize: '0.75rem', color: tokens.color.muted }}>
                            {[
                              r.team1 && r.team2 ? `${r.team1} vs ${r.team2}` : null,
                              r.clips ? t('highlights.watch.plays', { count: r.clips }) : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Box>
                        </Box>
                      </Box>
                    </Box>
                  ))}
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Container>
  );
}
