import type { ComponentType } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import type { MatchLiveStats } from '../../types';
import { getMapDisplayName } from '../../constants/maps';
import { fontDisplay, mono, radii, textSize, tokens } from '../../theme/tokens';
import { fmtClock } from '../../utils/time';
import { LivePlayersTable } from './LivePlayersTable';
import { SectionTitle, panel } from '../tournament/ui/draftUi';
import { PlayerChip } from '../player/PlayerChip';
import type { Untrusted } from '../../utils/untrusted';

const { color } = tokens;

interface RoomPlayer {
  steamid: string;
  name: string;
  avatar?: string;
}

/** What the match page knows about a match, for someone who does not play in it. */
export interface SpectatorRoomMatch {
  slug?: string;
  status: string;
  vetoCompleted?: boolean;
  /** GET /api/matches/:slug: false while its tournament has not started (no veto yet). */
  tournamentStarted?: boolean | null;
  serverId?: string | null;
  team1?: { id?: string | null; name: string | null; tag?: string | null } | null;
  team2?: { id?: string | null; name: string | null; tag?: string | null } | null;
  team1LogoUrl?: string | null;
  team2LogoUrl?: string | null;
  config?: {
    team1?: { name?: string; players?: RoomPlayer[] | Record<string, Untrusted> };
    team2?: { name?: string; players?: RoomPlayer[] | Record<string, Untrusted> };
  } | null;
}

type Step = 'veto' | 'server' | 'live' | 'result';

function playersOf(
  team: { players?: RoomPlayer[] | Record<string, Untrusted> } | undefined
): RoomPlayer[] {
  const players = team?.players;
  if (Array.isArray(players)) return players.filter((p) => p && p.steamid);
  return [];
}

/** The live score and player lines, kept fresh while the match runs. */
function useLiveStats(slug: string | undefined, on: boolean): MatchLiveStats | null {
  const [live, setLive] = useState<MatchLiveStats | null>(null);
  const socket = useSocket();
  const load = useCallback(() => {
    if (!slug || !on) return;
    api
      .get<MatchLiveStats & { success: boolean }>(`/api/events/live/${encodeURIComponent(slug)}`)
      .then((res) => setLive(res?.success ? res : null))
      .catch(() => setLive(null));
  }, [slug, on]);
  useEffect(() => {
    load();
    if (!slug || !on) return undefined;
    const changed = () => load();
    socket.on(`match:update:${slug}`, changed);
    const timer = window.setInterval(load, 15000);
    return () => {
      socket.off(`match:update:${slug}`, changed);
      window.clearInterval(timer);
    };
  }, [load, slug, on, socket]);
  return live;
}

interface CheckIn {
  open: boolean;
  teams: Array<{
    teamId: string;
    name: string;
    players: Array<{ role: string; checkedIn: boolean }>;
  }>;
}

/** The match's check-in (`/api/match-check-in`), while the match is not on a server. */
function useCheckIn(slug: string | undefined, on: boolean): CheckIn | null {
  const [state, setState] = useState<CheckIn | null>(null);
  const socket = useSocket();
  useEffect(() => {
    if (!slug || !on) return undefined;
    const load = () =>
      api
        .get<{ state: CheckIn | null }>(`/api/match-check-in/${encodeURIComponent(slug)}`)
        .then((res) => setState(res.state ?? null))
        .catch(() => setState(null));
    load();
    socket.on(`match:update:${slug}`, load);
    const timer = window.setInterval(load, 15000);
    return () => {
      socket.off(`match:update:${slug}`, load);
      window.clearInterval(timer);
    };
  }, [slug, on, socket]);
  return on ? state : null;
}

/** Seconds since `since` (unix s), ticking while there is one. */
function useSince(since: number | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);
  return since ? Math.max(0, Math.floor(now / 1000 - since)) : null;
}

/**
 * The match room for everyone who does not play in it: a panel where the
 * stream will be with the match's state (veto, server, live score, result),
 * and the players: the live table while a map is played, the rosters before.
 */
export function SpectatorRoom({
  match,
  hasVeto,
  Watch,
}: {
  match: SpectatorRoomMatch;
  hasVeto: boolean;
  /** The game's "Watch match" (`ClientGameIntegration.spectatorWatch`; CS2: GOTV). */
  Watch?: ComponentType<{ matchSlug: string }>;
}) {
  const { t } = useTranslation();
  const now: Step =
    match.status === 'completed' || match.status === 'cancelled'
      ? 'result'
      : match.status === 'live' || match.status === 'loaded'
        ? 'live'
        : hasVeto && match.vetoCompleted === false
          ? 'veto'
          : 'server';
  // Before the tournament starts nothing is under way: no step lit (the veto was, before).
  const waitsForStart = match.tournamentStarted === false && match.status === 'pending';
  const live = useLiveStats(match.slug, now === 'live');
  const pause = now === 'live' ? (live?.pause ?? null) : null;
  const pausedFor = useSince(pause?.since);
  const checkIn = useCheckIn(match.slug, now === 'veto' || now === 'server');
  const checkInOpen = !!checkIn?.open && !waitsForStart;

  const serverText = waitsForStart
    ? t('matchPage.spectator.server.notStarted')
    : now === 'veto'
      ? t('matchPage.spectator.server.afterVeto')
      : now === 'server'
        ? match.serverId
          ? t('matchPage.spectator.server.loading')
          : t('matchPage.spectator.server.waiting')
        : now === 'live'
          ? t('matchPage.spectator.server.playing')
          : t('matchPage.spectator.server.freed');

  const teams = [
    {
      key: 'team1' as const,
      name: match.team1?.name ?? match.config?.team1?.name ?? '',
      players: playersOf(match.config?.team1),
    },
    {
      key: 'team2' as const,
      name: match.team2?.name ?? match.config?.team2?.name ?? '',
      players: playersOf(match.config?.team2),
    },
  ];
  const avatars: Record<string, string | undefined> = {};
  const names: Record<string, string | undefined> = {};
  for (const team of teams) {
    for (const p of team.players) {
      avatars[p.steamid] = p.avatar;
      names[p.steamid] = p.name;
    }
  }
  const mapLabel = live?.mapName ? getMapDisplayName(live.mapName) : null;
  const mapOf =
    live && live.totalMaps > 1
      ? t('yourMatch.mapOf', { n: (live.mapNumber ?? 0) + 1, total: live.totalMaps })
      : null;

  return (
    <Box data-testid="match-spectator-room" sx={{ display: 'grid', gap: 2.5 }}>
      {/* Where the stream will be (the drafts' match page v2): the match's state, and while
          it is live with no stream, the score in its place. */}
      <Box
        component="section"
        aria-labelledby="spectator-now"
        data-testid="match-spectator-hero"
        data-state={waitsForStart ? 'notStarted' : now}
        sx={{
          ...panel,
          position: 'relative',
          aspectRatio: { sm: '16 / 9' },
          minHeight: 220,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1.5,
          px: 3,
          pt: 7,
          pb: 3,
          textAlign: 'center',
          border: `1px solid ${pause || checkInOpen ? color.warning : now === 'live' ? color.live : color.rule}`,
        }}
      >
        <Box
          component="span"
          sx={{
            position: 'absolute',
            top: 14,
            left: 14,
            px: 1.25,
            py: 0.5,
            borderRadius: radii.pill,
            fontSize: textSize.xs,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            bgcolor:
              pause || checkInOpen ? color.warning : now === 'live' ? color.live : color.paper3,
            color: pause || checkInOpen || now === 'live' ? color.accentInk : color.ink2,
          }}
        >
          {pause
            ? t('liveMatchesPage.pause.type.unknown')
            : checkInOpen
              ? t('matchCheckIn.eyebrowNoTime')
              : t(`matchPage.spectator.step.${now}`)}
        </Box>
        {now === 'live' && live ? (
          <>
            <Typography id="spectator-now" component="h2" sx={{ m: 0, color: color.ink2 }}>
              {[mapOf, mapLabel].filter(Boolean).join(' · ')}
            </Typography>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: { xs: 2, sm: 3 },
                fontFamily: fontDisplay,
                fontWeight: 800,
              }}
            >
              <Typography component="span" sx={{ fontWeight: 700, color: color.ink2 }}>
                {teams[0].name}
              </Typography>
              <Typography
                component="span"
                aria-label={t('matchInfo.spectator.scoreAria', {
                  a: live.team1Score,
                  b: live.team2Score,
                })}
                sx={{ ...mono, fontSize: { xs: '3rem', sm: '4.5rem' }, lineHeight: 1 }}
              >
                {live.team1Score}:{live.team2Score}
              </Typography>
              <Typography component="span" sx={{ fontWeight: 700, color: color.ink2 }}>
                {teams[1].name}
              </Typography>
            </Box>
            {pause && (
              <Typography data-testid="match-spectator-pause" sx={{ color: color.warning }}>
                {[
                  t(`liveMatchesPage.pause.type.${pause.type ?? 'unknown'}`, {
                    defaultValue: t('liveMatchesPage.pause.type.unknown'),
                  }),
                  pausedFor != null ? fmtClock(pausedFor) : null,
                  pause.by ? t('liveMatchesPage.pause.by', { name: pause.by }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Typography>
            )}
          </>
        ) : (
          <Typography
            id="spectator-now"
            component="h2"
            sx={{ m: 0, fontFamily: fontDisplay, fontSize: '1.5rem', fontWeight: 700 }}
          >
            {waitsForStart
              ? t('matchPage.spectator.notStartedTitle')
              : now === 'live'
                ? t('yourMatch.live')
                : t(`matchPage.spectator.step.${now}`)}
          </Typography>
        )}
        {checkInOpen && (
          <Box data-testid="match-spectator-checkin" sx={{ display: 'grid', gap: 0.5 }}>
            {checkIn.teams.map((team) => {
              const starters = team.players.filter((p) => p.role === 'starter');
              return (
                <Typography key={team.teamId} sx={{ color: color.ink2 }}>
                  <Box component="span" sx={{ fontWeight: 700, color: color.ink }}>
                    {team.name}
                  </Box>
                  {' · '}
                  {t('matchCheckIn.count', {
                    in: starters.filter((p) => p.checkedIn).length,
                    total: starters.length,
                  })}
                </Typography>
              );
            })}
          </Box>
        )}
        <Typography data-testid="match-spectator-server" sx={{ color: color.ink2 }}>
          {serverText}
        </Typography>
      </Box>

      {/* The game's way to watch it (CS2: GOTV, a little behind the players). */}
      {Watch && now === 'live' && match.slug && <Watch matchSlug={match.slug} />}

      {now === 'live' && live?.playerStats ? (
        <LivePlayersTable
          stats={live.playerStats}
          team1={{
            id: match.team1?.id ?? undefined,
            name: teams[0].name,
            tag: match.team1?.tag,
            logoUrl: match.team1LogoUrl,
          }}
          team2={{
            id: match.team2?.id ?? undefined,
            name: teams[1].name,
            tag: match.team2?.tag,
            logoUrl: match.team2LogoUrl,
          }}
          avatars={avatars}
          names={names}
          rounds={live.roundNumber || live.team1Score + live.team2Score}
          title={t('liveMatch.players')}
          note={
            live.delaySeconds
              ? `${t('liveMatch.delayedNote', { count: live.delaySeconds })} ${t('liveMatch.noEconomy')}`
              : t('liveMatch.noEconomy')
          }
        />
      ) : (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 16rem), 1fr))',
            alignItems: 'start',
          }}
        >
          {teams.map((team) => (
            <Box
              key={team.key}
              component="section"
              data-testid={`match-spectator-${team.key}`}
              sx={panel}
            >
              <SectionTitle title={team.name || t('matchPage.spectator.tbd')} />
              {team.players.length === 0 ? (
                <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
                  {t('matchPage.spectator.noRoster')}
                </Typography>
              ) : (
                <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1 }}>
                  {team.players.map((p) => (
                    <li key={p.steamid}>
                      <PlayerChip id={p.steamid} name={p.name} avatarUrl={p.avatar} />
                    </li>
                  ))}
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
