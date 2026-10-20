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
import { AvatarStack, InfoTile, PlayerAvatar, StatusHero } from '../ui/draftUi';
import type { ShufflePlayer } from '../../../hooks/useTournamentSignup';
import {
  ShuffleAdminPlayers,
  ShuffleThisRound,
  ShuffleTimeline,
  type ShuffleRound,
} from './ShuffleRoundParts';

const { color } = tokens;

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
  // Marked out for not joining their match: the next draws go on without them until
  // they say they are back (sign-up closing does not keep them out).
  const noShow =
    !!steamId &&
    started &&
    players.some((p) => p.steamId === steamId && p.left && p.leftReason === 'no_show');
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
    : noShow
      ? t('shuffleJoin.noShowTitle')
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
    : noShow
      ? t('shuffleJoin.noShowBody')
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
    ids.map((id) => ({ id, name: nameOf.get(id) ?? id, avatar: avatarOf.get(id) ?? null }));
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
          {noShow && !finished && (
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => void act(true)}
              data-testid="shuffle-back-in"
              sx={{
                minHeight: 56,
                borderRadius: radii.pill,
                fontWeight: 700,
                fontSize: '1.0625rem',
              }}
            >
              {t('shuffleJoin.backIn')}
            </Button>
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
              : open &&
                !noShow && (
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
              <PlayerAvatar id={p.steamId} name={p.name} avatar={p.avatar} size={32} label />
            </Box>
          ))}
        </Box>
      )}
    </StatusHero>
  );

  const timeline =
    round?.maps && round.maps.length > 0 ? (
      <ShuffleTimeline maps={round.maps} roundNo={roundNo} finished={finished} />
    ) : null;

  const thisRound =
    round && roundNo !== null && round.matches.length > 0 && !finished ? (
      <ShuffleThisRound
        round={round}
        roundNo={roundNo}
        myMap={myMap}
        myMatchSlug={myMatch?.slug}
        earlier={earlier}
        names={names}
        faces={faces}
      />
    ) : null;

  const adminPlayers =
    isAdmin && started && !finished && players.length > 0 ? (
      <ShuffleAdminPlayers
        players={players}
        sittingOut={sittingOut}
        marking={marking}
        onMark={(id, out) => void markOut(id, out)}
      />
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
