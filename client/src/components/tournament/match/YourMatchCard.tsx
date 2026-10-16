import { useCallback, type ReactNode } from 'react';
import { PresenceDot } from '../../social/PresenceDot';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { TeamMatchInfo } from '../../../types';
import { useTeamMatchData } from '../../../hooks/useTeamMatchData';
import { useRoundLabel } from '../../../hooks/useRoundLabel';
import { useIntegrationFor } from '../../../integrations/registry';
import { MatchMapChips } from '../../team/MatchMapChips';
import { LivePlayersTable } from '../../match/LivePlayersTable';
import { SectionTitle, StatePill, TeamLogo, panel } from '../ui/draftUi';
import { getMapDisplayName } from '../../../constants/maps';
import { matchPhaseOf } from '../../../utils/matchPhase';
import { tokens, fontDisplay, mono, radii } from '../../../theme/tokens';
import { panelSx, panelBorderSx } from '../../../components/common/ui';

const { color } = tokens;

/** Maps won by each side, from the finished maps or the live series score. */
function seriesWins(match: TeamMatchInfo): { team1: number; team2: number } {
  if (match.mapResults?.length) {
    return match.mapResults.reduce(
      (acc, r) => {
        if (r.team1Score > r.team2Score) acc.team1 += 1;
        else if (r.team2Score > r.team1Score) acc.team2 += 1;
        return acc;
      },
      { team1: 0, team2: 0 }
    );
  }
  return {
    team1: match.liveStats?.team1SeriesScore ?? 0,
    team2: match.liveStats?.team2SeriesScore ?? 0,
  };
}

/** A side's players: a face, the name, and whether they are in the server. */
function InServerList({
  players,
  connected,
  ready,
}: {
  players: Array<{ steamid: string; name: string; avatar?: string }>;
  connected: Set<string>;
  /** Players in the server who typed .r (the draft's Ready chip). */
  ready: Set<string>;
}) {
  const { t } = useTranslation();
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {players.map((player) => {
        const isIn = connected.has(player.steamid);
        const isReady = isIn && ready.has(player.steamid);
        return (
          <Box
            key={player.steamid}
            component="li"
            data-testid="your-match-player"
            data-in-server={isIn ? 'true' : 'false'}
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}
          >
            <Box
              component="span"
              sx={{
                width: 32,
                height: 32,
                flex: 'none',
                borderRadius: '50%',
                bgcolor: color.paper3,
                backgroundImage: player.avatar ? `url("${player.avatar}")` : 'none',
                backgroundSize: 'cover',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 600,
                fontSize: '0.8125rem',
                opacity: isIn ? 1 : 0.45,
              }}
            >
              {!player.avatar && player.name.slice(0, 1).toUpperCase()}
            </Box>
            <PresenceDot playerId={player.steamid} />
            <Typography
              sx={{
                flex: 1,
                minWidth: 0,
                color: isIn ? color.ink : color.muted,
                overflowWrap: 'anywhere',
              }}
            >
              {player.name}
            </Typography>
            <Box
              component="span"
              data-testid="your-match-player-state"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1.25,
                py: 0.25,
                borderRadius: radii.pill,
                bgcolor: color.paper3,
                fontSize: '0.8125rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                color: isReady ? color.live : isIn ? color.ink2 : color.muted,
              }}
            >
              <Box
                component="span"
                aria-hidden
                sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'currentColor' }}
              />
              {isReady
                ? t('yourMatch.ready')
                : isIn
                  ? t('yourMatch.inServer')
                  : t('yourMatch.notJoined')}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * The tournament page's "Your match" tab (boards 7a, 7b and 7c): one card
 * that changes with the match. A picture of the map once it is known, your
 * team against theirs with the score, one status line saying what happens now,
 * then the part that matters at that moment: the map veto, who is in the
 * server, or the scoreboard. The maps of the series sit at the bottom: the
 * game's map cards (`mapsView`, from the match room) or, without them, pills.
 *
 * It is the player's part of the match room (`/match/:slug`), the one place
 * a match is played from. With `matchSlug`, it shows only while that match is
 * the team's current one; otherwise it renders `fallback` (an older match's
 * page is its public view).
 */
export function YourMatchCard({
  teamId,
  matchSlug,
  fallback = null,
  mapsView,
}: {
  teamId: string;
  matchSlug?: string;
  fallback?: ReactNode;
  /** The series' maps as cards (the module's seriesMapsView), in place of the pills. */
  mapsView?: ReactNode;
}) {
  const { t } = useTranslation();
  const { team, match, hasMatch, loading, tournamentStatus, loadTeamMatch } =
    useTeamMatchData(teamId);
  const getRoundLabel = useRoundLabel();
  const integration = useIntegrationFor(match);
  const PreMatchView = integration.preMatchView;
  const ConnectPanel = integration.matchPanels.teamView;

  const onVetoComplete = useCallback(() => {
    window.setTimeout(() => void loadTeamMatch(true), 1000);
  }, [loadTeamMatch]);

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress aria-label={t('yourMatch.loading')} />
      </Box>
    );
  }

  if (matchSlug && (!hasMatch || !match || match.slug !== matchSlug)) {
    return <>{fallback}</>;
  }

  if (!hasMatch || !match) {
    return (
      <Box
        data-testid="your-match-none"
        sx={{
          ...panelSx,
          ...panelBorderSx,
          p: 3,
        }}
      >
        <Typography sx={{ fontWeight: 600 }}>
          {tournamentStatus === 'completed'
            ? t('teamPage.tournamentFinished')
            : t('teamPage.noMatchNow')}
        </Typography>
        <Typography sx={{ color: color.ink2, mt: 0.5, fontSize: '0.875rem' }}>
          {tournamentStatus === 'completed' ? '' : t('teamPage.noMatchNowHint')}
        </Typography>
      </Box>
    );
  }

  const phase = matchPhaseOf(match, tournamentStatus);
  const viewerIsMember = match.viewerIsTeamMember !== false;
  const us = match.isTeam1 ? 'team1' : 'team2';
  const them = match.isTeam1 ? 'team2' : 'team1';
  const ourName = team?.name ?? match[us]?.name ?? match.config?.[us]?.name ?? '';
  const theirName = match.opponent?.name ?? match.config?.[them]?.name ?? t('home.tbd');
  const ourTag = team?.tag ?? match[us]?.tag ?? match.config?.[us]?.tag;
  const theirTag = match.opponent?.tag ?? match.config?.[them]?.tag;
  const ourLogo = match[us]?.logoUrl ?? null;
  const theirLogo = match.opponent?.logoUrl ?? null;

  const live = match.liveStats;
  const mapKey = phase === 'veto' ? null : (live?.mapName ?? match.currentMap ?? null);
  const mapNumber = live?.mapNumber ?? match.mapNumber ?? null;
  const totalMaps = live?.totalMaps ?? match.maps?.length ?? null;

  const wins = seriesWins(match);
  const ourMaps = wins[us];
  const theirMaps = wins[them];
  const ourRounds = live ? (match.isTeam1 ? live.team1Score : live.team2Score) : 0;
  const theirRounds = live ? (match.isTeam1 ? live.team2Score : live.team1Score) : 0;
  const formatLabel = t('yourMatch.bestOf', {
    count: Number(match.matchFormat.replace('bo', '')) || 1,
  });
  const roundLabel = match.round === 0 ? t('teamPage.manualMatch') : getRoundLabel(match.round);

  const connected = new Set((match.connectionStatus?.connectedPlayers ?? []).map((p) => p.steamId));
  const ready = new Set(
    (match.connectionStatus?.connectedPlayers ?? []).filter((p) => p.isReady).map((p) => p.steamId)
  );
  const expected =
    match.config?.expected_players_total ??
    (match.config?.players_per_team ? match.config.players_per_team * 2 : 10);
  const inServer = match.connectionStatus?.totalConnected ?? 0;

  // Which side each team is on now (draft 7c): the map's starting side from
  // the config, swapped after the first half. Nothing for a knife round.
  const config = (match.config ?? {}) as { map_sides?: string[]; cvars?: Record<string, unknown> };
  const sideCode = typeof mapNumber === 'number' ? config.map_sides?.[mapNumber] : undefined;
  const team1Starts = sideCode === 'team1_ct' ? 'CT' : sideCode === 'team2_ct' ? 'T' : null;
  const half = Number(config.cvars?.mp_maxrounds ?? 24) / 2;
  const swapped = (live?.roundNumber ?? 0) > half;
  const team1Now =
    team1Starts === null ? null : swapped ? (team1Starts === 'CT' ? 'T' : 'CT') : team1Starts;
  const ourSide =
    team1Now === null ? null : match.isTeam1 ? team1Now : team1Now === 'CT' ? 'T' : 'CT';

  const join =
    ConnectPanel && viewerIsMember ? (
      <Box sx={{ width: '100%' }}>
        <ConnectPanel
          matchSlug={match.slug}
          viewerCanJoin={viewerIsMember}
          matchStatus={match.status}
          waitingSaidByPage={!match.server}
        />
      </Box>
    ) : null;

  const mapLabel = mapKey ? getMapDisplayName(mapKey) : null;
  const mapOfLabel =
    typeof mapNumber === 'number' && totalMaps && totalMaps > 1
      ? t('yourMatch.mapOf', { n: mapNumber + 1, total: totalMaps })
      : null;
  const outcome = ourMaps > theirMaps ? 'won' : ourMaps < theirMaps ? 'lost' : 'draw';

  // The card's title, its colour and the pill on its right (the drafts' match room).
  let title: string;
  let ring: string = color.rule;
  let pill: ReactNode = null;
  let detail: ReactNode = null;
  if (phase === 'notStarted') {
    title = t('matchInfo.waitingForTournamentTitle');
    detail = t('matchInfo.waitingForTournamentBody');
  } else if (phase === 'waitingOpponent') {
    title = t('matchInfo.waitingForOpponentTitle');
    detail = t('matchInfo.waitingForOpponentBody');
  } else if (phase === 'veto') {
    title = t('yourMatch.vetoTitle');
    ring = color.accent;
  } else if (
    phase === 'joining' &&
    !match.server &&
    match.status !== 'loaded' &&
    match.status !== 'live'
  ) {
    // No server yet (the drafts' "Waiting for a server"): the queue place comes from the join panel.
    title = t('yourMatch.waitingForServer');
    pill = mapLabel ? (
      <StatePill
        state="upcoming"
        label={
          match.config?.vetoDisabled
            ? t('yourMatch.mapDrawnChip', { map: mapLabel })
            : t('yourMatch.vetoDoneChip', { map: mapLabel })
        }
      />
    ) : null;
    detail = t('yourMatch.waitingForServerBody');
  } else if (phase === 'joining') {
    title = mapLabel
      ? t('liveMatch.joinTitle', { map: mapLabel })
      : t('yourMatch.waitingForPlayers');
    ring = color.live;
    pill = <StatePill state="live" label={t('liveMatch.warmup')} />;
    detail = match.config?.bot_fill
      ? t('yourMatch.inServerCountBots', { count: inServer })
      : t('yourMatch.inServerCount', { count: inServer, expected });
  } else if (phase === 'live') {
    title = [mapOfLabel, mapLabel ? t('liveMatch.isLive', { map: mapLabel }) : t('yourMatch.live')]
      .filter(Boolean)
      .join(' · ');
    ring = color.live;
    pill = (
      <Typography
        component="span"
        data-testid="your-match-score"
        sx={{ ...mono, fontSize: '1.375rem', whiteSpace: 'nowrap' }}
      >
        {ourRounds} – {theirRounds}
        {live?.roundNumber ? (
          <Box component="span" sx={{ fontSize: '0.875rem', color: color.muted }}>
            {' '}
            · {t('yourMatch.round', { n: live.roundNumber })}
          </Box>
        ) : null}
      </Typography>
    );
    detail = ourSide ? (
      <Box
        component="span"
        data-testid="your-match-side"
        sx={{ color: ourSide === 'CT' ? color.sideCt : color.sideT, fontWeight: 600 }}
      >
        {t('yourMatch.sideYou', { side: ourSide })}
      </Box>
    ) : null;
  } else {
    title = t(`yourMatch.outcome.${outcome}`, {
      us: ourMaps,
      them: theirMaps,
      opponent: theirName,
    });
    ring = outcome === 'won' ? color.live : color.rule;
    detail = t('yourMatch.finished');
  }

  const roster = (
    side: 'team1' | 'team2',
    name: string,
    tag?: string,
    logoUrl?: string | null,
    sideNow?: string | null
  ) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <Box
        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}
      >
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 1,
            fontFamily: fontDisplay,
            fontWeight: 700,
          }}
        >
          <TeamLogo team={{ id: match[side]?.id, name, tag, logoUrl }} size="sm" />
          {name}
        </Box>
        {sideNow && (
          <Typography component="span" sx={{ fontSize: '0.8125rem', color: color.muted }}>
            {sideNow}
          </Typography>
        )}
      </Box>
      <InServerList
        players={match.config?.[side]?.players ?? []}
        connected={connected}
        ready={ready}
      />
    </Box>
  );

  const avatars: Record<string, string | undefined> = {};
  const names: Record<string, string | undefined> = {};
  for (const side of ['team1', 'team2'] as const) {
    for (const p of match.config?.[side]?.players ?? []) {
      avatars[p.steamid] = p.avatar;
      names[p.steamid] = p.name;
    }
  }

  // The veto is its own page-wide block (the drafts' veto board), not a card in a card.
  if (phase === 'veto' && PreMatchView && viewerIsMember) {
    return (
      <Box
        data-testid="your-match"
        data-phase={phase}
        sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}
      >
        <PreMatchView
          matchSlug={match.slug}
          team1Name={match.team1?.name ?? match.config?.team1?.name}
          team2Name={match.team2?.name ?? match.config?.team2?.name}
          currentTeamSlug={team?.id ?? us}
          onComplete={onVetoComplete}
          hideMatchHeader
        />
      </Box>
    );
  }

  return (
    <Box
      data-testid="your-match"
      data-phase={phase}
      sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}
    >
      <Box
        component="section"
        aria-labelledby="your-match-title"
        sx={{ ...panel, border: `2px solid ${ring}` }}
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
            id="your-match-title"
            component="h2"
            data-testid="your-match-status"
            sx={{
              m: 0,
              fontFamily: fontDisplay,
              fontSize: '1.5rem',
              fontWeight: 700,
              lineHeight: 1.2,
            }}
          >
            {title}
          </Typography>
          {pill}
        </Box>
        {detail && (
          <Typography sx={{ m: 0, color: color.ink2, fontSize: '1rem' }}>{detail}</Typography>
        )}
        {phase === 'veto' &&
          (PreMatchView && viewerIsMember ? (
            <PreMatchView
              matchSlug={match.slug}
              team1Name={match.team1?.name ?? match.config?.team1?.name}
              team2Name={match.team2?.name ?? match.config?.team2?.name}
              currentTeamSlug={team?.id ?? us}
              onComplete={onVetoComplete}
              hideMatchHeader
            />
          ) : null)}
        {(phase === 'joining' || phase === 'live') && join}
        {phase === 'live' && join && (
          <Typography
            sx={{ fontSize: '0.8125rem', color: color.muted }}
            data-testid="your-match-rejoin"
          >
            {t('yourMatch.rejoin')}
          </Typography>
        )}
        <Typography
          component="span"
          sx={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
            whiteSpace: 'nowrap',
          }}
        >
          {[ourName, theirName, roundLabel, formatLabel, mapLabel].filter(Boolean).join(' · ')}
        </Typography>
      </Box>

      {mapsView ? (
        <Box component="section" data-testid="your-match-maps" sx={panel}>
          {mapsView}
        </Box>
      ) : (
        phase !== 'veto' &&
        match.maps?.length > 0 && (
          <Box sx={panel}>
            <MatchMapChips match={match} currentMapNumber={mapNumber} />
          </Box>
        )
      )}

      {phase === 'joining' && (
        <Box component="section" aria-labelledby="your-match-players" sx={panel}>
          <SectionTitle
            id="your-match-players"
            title={t('liveMatch.players')}
            note={t('yourMatch.inServerCount', { count: inServer, expected })}
          />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 16rem), 1fr))',
              gap: 2,
            }}
          >
            {roster(us, ourName, ourTag, ourLogo, null)}
            {roster(them, theirName, theirTag, theirLogo, null)}
          </Box>
        </Box>
      )}

      {phase === 'live' && live?.playerStats && (
        <LivePlayersTable
          stats={live.playerStats}
          team1={{
            id: match.team1?.id,
            name: match.team1?.name ?? match.config?.team1?.name ?? '',
            tag: match.team1?.tag,
            logoUrl: match.team1?.logoUrl,
          }}
          team2={{
            id: match.team2?.id,
            name: match.team2?.name ?? match.config?.team2?.name ?? '',
            tag: match.team2?.tag,
            logoUrl: match.team2?.logoUrl,
          }}
          avatars={avatars}
          names={names}
          rounds={live.roundNumber || (live.team1Score ?? 0) + (live.team2Score ?? 0)}
          title={
            mapOfLabel ? t('liveMatch.playersOnMap', { map: mapOfLabel }) : t('liveMatch.players')
          }
          note={t('liveMatch.noEconomy')}
        />
      )}
    </Box>
  );
}
