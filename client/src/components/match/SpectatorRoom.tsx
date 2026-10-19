import type { ComponentType } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import type { MatchLiveStats } from '../../types';
import { getMapDisplayName } from '../../constants/maps';
import { fontDisplay, mono, radii, textSize, tokens } from '../../theme/tokens';
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

/**
 * The match room for everyone who does not play in it (the drafts' spectator
 * board): where the match is (veto, server, live, result) as steps, a card
 * with what is on now (connecting is for the two teams), and the players: the
 * live table while a map is played, the rosters before.
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
  const steps: Step[] = hasVeto
    ? ['veto', 'server', 'live', 'result']
    : ['server', 'live', 'result'];
  const now: Step =
    match.status === 'completed' || match.status === 'cancelled'
      ? 'result'
      : match.status === 'live' || match.status === 'loaded'
        ? 'live'
        : hasVeto && match.vetoCompleted === false
          ? 'veto'
          : 'server';
  const nowIndex = steps.indexOf(now);
  const live = useLiveStats(match.slug, now === 'live');

  const serverText =
    now === 'veto'
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
      <Box
        component="ol"
        aria-label={t('matchPage.spectator.steps')}
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          display: 'grid',
          gap: 1,
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 9rem), 1fr))',
        }}
      >
        {steps.map((step, i) => {
          const done = i < nowIndex;
          const current = i === nowIndex;
          return (
            <Box
              component="li"
              key={step}
              aria-current={current ? 'step' : undefined}
              data-testid={`match-step-${step}`}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.25,
                px: 2,
                py: 1.5,
                borderRadius: radii.md,
                bgcolor: current ? color.paper3 : color.paper2,
                border: `2px solid ${current ? color.live : 'transparent'}`,
              }}
            >
              <Typography
                component="span"
                sx={{
                  fontSize: textSize.sm,
                  fontWeight: 700,
                  color: current ? color.live : done ? color.ink2 : color.muted,
                }}
              >
                {done ? '✓' : current ? '●' : '○'} {t(`matchPage.spectator.step.${step}`)}
              </Typography>
            </Box>
          );
        })}
      </Box>

      <Box
        component="section"
        aria-labelledby="spectator-now"
        sx={{ ...panel, border: `2px solid ${now === 'live' ? color.live : color.rule}` }}
      >
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 1.5,
          }}
        >
          <Typography
            id="spectator-now"
            component="h2"
            sx={{ m: 0, fontFamily: fontDisplay, fontSize: '1.5rem', fontWeight: 700 }}
          >
            {now === 'live'
              ? [mapOf, mapLabel ? t('liveMatch.isLive', { map: mapLabel }) : t('yourMatch.live')]
                  .filter(Boolean)
                  .join(' · ')
              : t(`matchPage.spectator.step.${now}`)}
          </Typography>
          {now === 'live' && live && (
            <Typography component="span" sx={{ ...mono, fontSize: '1.375rem' }}>
              {live.team1Score} – {live.team2Score}
            </Typography>
          )}
        </Box>
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
