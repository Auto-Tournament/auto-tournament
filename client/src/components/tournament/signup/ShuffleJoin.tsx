/**
 * Joining a shuffle tournament on your own: no team, the platform draws them each round. The
 * overview shows who is in and a Join (or Leave) button while sign-up is open; a visitor who
 * is not signed in is sent to sign in first.
 */
import React, { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Link, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../../../utils/api';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { matchPagePath, paths } from '../../../paths';
import { getMapDisplayName } from '../../../constants/maps';
import { useAuth } from '../../../contexts/AuthContext';
import { radii, tokens } from '../../../theme/tokens';
import {
  AvatarStack,
  InfoTile,
  MapTile,
  PlayerAvatar,
  SectionTitle,
  StatePill,
  StatusHero,
  YoursPill,
  panel,
} from '../ui/draftUi';
import type { ShufflePlayer } from '../../../hooks/useTournamentSignup';

const { color } = tokens;

interface ShuffleRound {
  round: number | null;
  /** The rounds' maps in order (one map a round). */
  maps?: string[];
  finished?: boolean;
  matches: Array<{
    slug: string;
    status: string;
    teams: Array<{ name: string | null; steamIds: string[] }>;
  }>;
  sittingOut: string[];
}

/** The running round: who plays where, who sits out (polled while the tournament runs). */
function useShuffleRound(tournamentId: number, started: boolean): ShuffleRound | null {
  const [round, setRound] = useState<ShuffleRound | null>(null);
  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    const load = () =>
      api
        .get<ShuffleRound>(`/api/tournament/${tournamentId}/shuffle-round`)
        .then((r) => !cancelled && setRound(r))
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [tournamentId, started]);
  return round;
}

export function ShuffleJoin({
  tournamentId,
  players,
  steamId,
  open,
  started,
  spots,
  onChange,
  earlier,
  side,
}: {
  tournamentId: number;
  players: ShufflePlayer[];
  /** The signed-in player; null for a visitor. */
  steamId: string | null;
  /** Sign-up is open now. */
  open: boolean;
  /** The tournament has started: joining or leaving counts from the next round's draw. */
  started: boolean;
  /** How many players it takes, when capped. */
  spots: number | null;
  onChange: () => Promise<void>;
  /** The earlier rounds' results, under this round (the drafts' shuffle board). */
  earlier?: React.ReactNode[];
  /** The standings beside the round. */
  side?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { showError } = useSnackbar();
  const [busy, setBusy] = useState(false);
  const joined = !!steamId && players.some((p) => p.steamId === steamId && !p.left);
  const round = useShuffleRound(tournamentId, started);
  // An admin marks players out (gone home) or back in while it runs: the next draw follows.
  const { isAuthenticated: isAdmin } = useAuth();
  const [marking, setMarking] = useState<string | null>(null);
  const markOut = async (steamId: string, out: boolean) => {
    setMarking(steamId);
    try {
      if (out) {
        const keep = players.filter((p) => !p.left && p.steamId !== steamId).map((p) => p.steamId);
        await api.put(`/api/tournament/${tournamentId}/set-players`, { playerIds: keep });
      } else {
        await api.post(`/api/tournament/${tournamentId}/register-players`, {
          playerIds: [steamId],
        });
      }
      await onChange();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setMarking(null);
    }
  };
  const roundNo = round?.round ?? null;
  const myMatch =
    steamId && round
      ? (round.matches.find((m) => m.teams.some((team) => team.steamIds.includes(steamId))) ?? null)
      : null;
  const myTeam = myMatch?.teams.find((team) => !!steamId && team.steamIds.includes(steamId));
  // Played this round's match already: waiting for the others before the next draw.
  const myMatchDone = myMatch?.status === 'completed' || myMatch?.status === 'cancelled';
  const sittingOut = new Set(round?.sittingOut ?? []);
  const nameOf = new Map(players.map((p) => [p.steamId, p.name]));
  const names = (ids: string[]) => ids.map((id) => nameOf.get(id) ?? id).join(' + ');
  const iSitOut = !!steamId && joined && roundNo !== null && sittingOut.has(steamId);
  const finished = round?.finished === true;
  // For the copy: players per team this round, players in the draw, matches still on.
  const teamSize = round?.matches[0]?.teams[0]?.steamIds.length || 2;
  const inDraw =
    (round?.matches.reduce(
      (n, m) => n + m.teams.reduce((k, team) => k + team.steamIds.length, 0),
      0
    ) ?? 0) + sittingOut.size;
  const stillPlaying =
    round?.matches.filter((m) => m.status !== 'completed' && m.status !== 'cancelled').length ?? 0;
  const title = finished
    ? t('shuffleJoin.finishedTitle')
    : joined && roundNo !== null && myMatch && myMatchDone
      ? t('shuffleJoin.playedTitle', { round: roundNo })
      : joined && roundNo !== null && myMatch
        ? t('shuffleJoin.playingTitle', { round: roundNo })
        : iSitOut
          ? t('shuffleJoin.sittingOutTitle', { round: roundNo })
          : joined
            ? t('shuffleJoin.youreIn')
            : t('shuffleJoin.title');
  const body = finished
    ? t('shuffleJoin.finishedBody', { count: round?.maps?.length ?? roundNo ?? 0 })
    : joined && myMatch && myMatchDone
      ? t('shuffleJoin.playedBodyLeft', { count: stillPlaying, next: (roundNo ?? 0) + 1 })
      : joined && myMatch
        ? t('shuffleJoin.playingBody', { team: myTeam?.name ?? '' })
        : iSitOut
          ? t('shuffleJoin.sittingOutBodyCounts', {
              players: inDraw,
              size: teamSize,
              size2: teamSize,
              count: sittingOut.size,
            })
          : joined
            ? t('shuffleJoin.inBody')
            : t('shuffleJoin.body');
  const full = spots !== null && players.length >= spots && !joined;

  const act = async (join: boolean) => {
    setBusy(true);
    try {
      if (join) await api.post(`/api/tournament-signup/${tournamentId}/join`, {});
      else await api.delete(`/api/tournament-signup/${tournamentId}/join`);
      await onChange();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const avatarOf = new Map(players.map((p) => [p.steamId, p.avatar]));
  const faces = (ids: string[]) =>
    ids.map((id) => ({ name: nameOf.get(id) ?? id, avatar: avatarOf.get(id) ?? null }));
  const total = round?.maps?.length ?? null;
  const roundLine =
    roundNo !== null && total ? t('shuffleJoin.roundOf', { round: roundNo, total }) : null;
  const myMap = roundNo !== null && round?.maps ? round.maps[roundNo - 1] : null;
  const playingNow = !!myMatch && !myMatchDone && !finished;
  const eyebrow = finished
    ? t('shuffleJoin.roundsCount', { count: total ?? roundNo ?? 0 })
    : roundLine
      ? [
          roundLine,
          playingNow
            ? myMatch?.status === 'live'
              ? t('shuffleOverview.yourMatchLive')
              : t('shuffleOverview.yourMatchReady')
            : myMatchDone
              ? t('shuffleOverview.yourMatchDone')
              : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : started
        ? t('overviewPage.status.inProgress')
        : spots !== null
          ? t('shuffleJoin.countOf', { count: players.length, spots })
          : t('shuffleJoin.count', { count: players.length });
  const ring = finished
    ? color.medalGold
    : playingNow
      ? color.live
      : joined && !started
        ? color.accent
        : color.rule;
  const opponents = myMatch?.teams.find((team) => !steamId || !team.steamIds.includes(steamId));

  const hero = (
    <StatusHero
      testId="shuffle-join"
      eyebrow={eyebrow}
      eyebrowColor={
        playingNow ? color.live : finished ? color.medalGold : iSitOut ? color.accent : color.muted
      }
      ring={ring}
      title={<span id="shuffle-join-title">{title}</span>}
      body={<span data-testid="shuffle-round-state">{body}</span>}
      side={
        <>
          {playingNow && myMatch && (
            <Button
              component={RouterLink}
              to={matchPagePath(myMatch.slug)}
              variant="contained"
              data-testid="shuffle-my-match"
              sx={{
                minHeight: 56,
                borderRadius: radii.pill,
                fontWeight: 700,
                fontSize: '1.0625rem',
              }}
            >
              {t('shuffleJoin.goToMatch')}
            </Button>
          )}
          {(iSitOut || myMatchDone) && !finished && roundNo !== null && (
            <InfoTile
              label={t('shuffleOverview.nextDraw')}
              value={t('shuffleOverview.round', { n: roundNo + 1 })}
              note={t('shuffleOverview.whenRoundEnds')}
            />
          )}
          {!steamId
            ? open && (
                <Button
                  component={RouterLink}
                  to={paths.login}
                  variant="contained"
                  data-testid="shuffle-join-sign-in"
                  sx={{ minHeight: 56, borderRadius: radii.pill, fontWeight: 700 }}
                >
                  {t('shuffleJoin.signInToJoin')}
                </Button>
              )
            : joined
              ? !finished &&
                !playingNow && (
                  // The drafts: a quiet line, not a second button next to the main one.
                  <Typography component="span" sx={{ fontSize: '0.875rem', color: color.muted }}>
                    {t('shuffleJoin.joinedByMistake')}{' '}
                    <Link
                      component="button"
                      type="button"
                      disabled={busy}
                      onClick={() => void act(false)}
                      data-testid="shuffle-leave"
                      sx={{ fontSize: 'inherit', verticalAlign: 'baseline' }}
                    >
                      {t('shuffleJoin.leave')}
                    </Link>
                  </Typography>
                )
              : open && (
                  <Button
                    variant="contained"
                    disabled={busy || full}
                    onClick={() => void act(true)}
                    data-testid="shuffle-join-button"
                    sx={{
                      minHeight: 56,
                      borderRadius: radii.pill,
                      fontWeight: 700,
                      fontSize: '1.0625rem',
                    }}
                  >
                    {full ? t('shuffleJoin.full') : t('shuffleJoin.join')}
                  </Button>
                )}
        </>
      }
    >
      {playingNow && myTeam && opponents && (
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 1.5,
            mt: 0.5,
            fontSize: '1rem',
          }}
        >
          <Box
            component="span"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontWeight: 600 }}
          >
            <AvatarStack players={faces(myTeam.steamIds)} size={28} />
            {names(myTeam.steamIds)}
          </Box>
          <Box component="span" sx={{ color: color.muted }}>
            {t('shuffleJoin.versus')}
          </Box>
          <Box
            component="span"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontWeight: 600 }}
          >
            <AvatarStack players={faces(opponents.steamIds)} size={28} />
            {names(opponents.steamIds)}
          </Box>
          {myMap && (
            <Box component="span" sx={{ color: color.muted }}>
              · {getMapDisplayName(myMap)}
            </Box>
          )}
        </Box>
      )}
      {!started && players.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }} data-testid="shuffle-players">
          {players.map((p) => (
            <Box
              key={p.steamId}
              title={p.name}
              sx={{
                outline: p.steamId === steamId ? `2px solid ${color.accent}` : 'none',
                outlineOffset: 2,
                borderRadius: '50%',
              }}
            >
              <PlayerAvatar name={p.name} avatar={p.avatar} size={32} label />
            </Box>
          ))}
        </Box>
      )}
    </StatusHero>
  );

  const timeline =
    round?.maps && round.maps.length > 0 ? (
      <Box
        component="section"
        aria-labelledby="shuffle-rounds-title"
        data-testid="shuffle-timeline"
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}
      >
        <SectionTitle
          id="shuffle-rounds-title"
          title={
            finished || roundNo === null
              ? t('shuffleJoin.roundsCount', { count: round.maps.length })
              : t('shuffleJoin.roundOf', { round: roundNo, total: round.maps.length })
          }
          note={t('shuffleOverview.oneMapPerRound')}
        />
        {/* One row of rounds; it scrolls sideways on a phone (no round alone on a last row). */}
        <Box
          component="ol"
          sx={{
            display: 'grid',
            gridAutoFlow: 'column',
            gridAutoColumns: { xs: '9.5rem', md: 'minmax(9rem, 1fr)' },
            overflowX: 'auto',
            pb: 0.5,
            gap: 1.5,
            m: 0,
            p: 0,
            listStyle: 'none',
          }}
        >
          {round.maps.map((map, index) => {
            const n = index + 1;
            const current = !finished && roundNo === n;
            const done = finished || (roundNo !== null && n < roundNo);
            const state = done
              ? 'done'
              : current
                ? 'now'
                : roundNo !== null && n === roundNo + 1
                  ? 'next'
                  : 'later';
            return (
              <Box
                component="li"
                key={`${n}-${map}`}
                aria-current={current ? 'step' : undefined}
                data-testid={current ? 'shuffle-timeline-current' : 'shuffle-timeline-map'}
              >
                <MapTile
                  map={map}
                  played={done}
                  ring={current ? color.live : 'transparent'}
                  top={
                    <>
                      <Box
                        component="span"
                        sx={{
                          px: 1,
                          py: 0.25,
                          borderRadius: radii.pill,
                          bgcolor: color.paper,
                          fontSize: '0.8125rem',
                        }}
                      >
                        {t('shuffleJoin.roundShort', { round: n })}
                      </Box>
                      <StatePill state={state} label={t(`liveOverview.state.${state}`)} />
                    </>
                  }
                />
              </Box>
            );
          })}
        </Box>
      </Box>
    ) : null;

  const matchRow = (m: ShuffleRound['matches'][number], done: boolean) => {
    const mine = m.slug === myMatch?.slug;
    const winnerSide = (m as { winner?: 0 | 1 | null }).winner;
    const side = (i: 0 | 1) => {
      const ids = m.teams[i]?.steamIds ?? [];
      const won = done && winnerSide === i;
      return (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            minWidth: 0,
            justifyContent: i === 1 ? 'flex-end' : 'flex-start',
            textAlign: i === 1 ? 'right' : 'left',
          }}
        >
          <Box sx={{ display: { xs: 'inline-flex', sm: 'none' } }}>
            <AvatarStack players={faces(ids)} size={26} />
          </Box>
          <Box
            component="span"
            sx={{
              display: { xs: 'none', sm: 'inline' },
              fontWeight: won ? 700 : 600,
              color: color.ink,
              overflowWrap: 'anywhere',
            }}
          >
            {names(ids)}
          </Box>
        </Box>
      );
    };
    return (
      <Box
        key={m.slug}
        component={RouterLink}
        to={matchPagePath(m.slug)}
        data-testid="shuffle-round-match"
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr) auto',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 1.75,
          borderRadius: radii.md,
          bgcolor: color.paper3,
          color: 'inherit',
          textDecoration: 'none',
          '&:hover': { filter: 'brightness(1.12)' },
        }}
      >
        {side(0)}
        <Box component="span" sx={{ color: color.muted, fontSize: '0.875rem' }}>
          {t('shuffleJoin.versus')}
        </Box>
        {side(1)}
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 1,
            minWidth: 56,
          }}
        >
          {mine && <YoursPill kind="match" />}
          <Typography
            component="span"
            sx={{
              fontSize: '0.8125rem',
              fontWeight: 600,
              textAlign: 'right',
              color: m.status === 'live' ? color.live : color.ink2,
            }}
          >
            {t(
              `shuffleJoin.status.${m.status === 'live' ? 'live' : m.status === 'completed' ? 'done' : 'waiting'}`
            )}
          </Typography>
        </Box>
      </Box>
    );
  };

  const thisRound =
    round && roundNo !== null && round.matches.length > 0 && !finished ? (
      <Box
        component="section"
        aria-labelledby="shuffle-this-round"
        data-testid="shuffle-round"
        sx={{ ...panel, flex: '999 1 520px' }}
      >
        <SectionTitle
          id="shuffle-this-round"
          title={`${t('shuffleJoin.roundHeading', { round: roundNo })}${myMap || round.maps?.[roundNo - 1] ? ` · ${getMapDisplayName((round.maps?.[roundNo - 1] ?? myMap) as string)}` : ''}`}
        />
        {round.matches.map((m) => matchRow(m, false))}
        {round.sittingOut.length > 0 && (
          <Box
            data-testid="shuffle-round-sitting-out"
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 1,
              color: color.ink2,
              fontSize: '0.875rem',
            }}
          >
            <Box component="span" sx={{ color: color.muted }}>
              {t('shuffleOverview.sittingOut')}
            </Box>
            <Box sx={{ display: { xs: 'inline-flex', sm: 'none' } }}>
              <AvatarStack players={faces(round.sittingOut)} size={26} />
            </Box>
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
              {names(round.sittingOut).replace(/ \+ /g, ', ')}
            </Box>
            <Box component="span" sx={{ color: color.muted }}>
              · {t('shuffleOverview.firstNextRound')}
            </Box>
          </Box>
        )}
        {earlier && earlier.length > 0 && (
          <>
            <Box sx={{ height: '1px', bgcolor: color.rule, my: 0.5 }} />
            <Typography
              component="h3"
              sx={{
                m: 0,
                fontSize: '0.875rem',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: color.muted,
                fontWeight: 600,
              }}
            >
              {t('liveOverview.earlier')}
            </Typography>
            {earlier}
          </>
        )}
      </Box>
    ) : null;

  const adminPlayers =
    isAdmin && started && !finished && players.length > 0 ? (
      <Box component="section" aria-labelledby="shuffle-admin-players" sx={panel}>
        <SectionTitle
          id="shuffle-admin-players"
          title={t('shuffleOverview.players')}
          note={t('shuffleOverview.markOutHint')}
        />
        <Box
          component="ol"
          sx={{
            listStyle: 'none',
            m: 0,
            p: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
          }}
          data-testid="shuffle-players"
        >
          {players.map((p) => (
            <Box
              component="li"
              key={p.steamId}
              sx={{
                display: 'grid',
                gridTemplateColumns: '32px minmax(0,1fr) auto auto',
                gap: 1.5,
                alignItems: 'center',
                px: 1.5,
                py: 1,
                borderRadius: radii.sm,
                bgcolor: color.paper3,
              }}
            >
              <PlayerAvatar name={p.name} avatar={p.avatar} size={32} />
              <Typography
                component="span"
                sx={{ color: p.left ? color.muted : color.ink, overflowWrap: 'anywhere' }}
              >
                {p.name}
              </Typography>
              <Typography
                component="span"
                sx={{
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: p.left ? color.ban : sittingOut.has(p.steamId) ? color.muted : color.live,
                }}
              >
                {p.left
                  ? t('shuffleJoin.tagLeft')
                  : sittingOut.has(p.steamId)
                    ? t('shuffleJoin.tagSittingOut')
                    : t('shuffleJoin.tagPlaying')}
              </Typography>
              <Button
                size="small"
                variant="outlined"
                disabled={marking === p.steamId}
                onClick={() => void markOut(p.steamId, !p.left)}
                data-testid="shuffle-mark-out"
                sx={{ minHeight: 36, borderRadius: radii.pill }}
              >
                {p.left ? t('shuffleJoin.markIn') : t('shuffleJoin.markOut')}
              </Button>
            </Box>
          ))}
        </Box>
      </Box>
    ) : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {hero}
      {timeline}
      {(thisRound || side) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'flex-start' }}>
          {thisRound}
          {side}
        </Box>
      )}
      {adminPlayers}
    </Box>
  );
}
