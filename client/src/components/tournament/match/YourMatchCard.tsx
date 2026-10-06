import { useCallback, type ReactNode } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { ClockIcon, PlayCircleIcon, TrophyIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TeamMatchInfo } from '../../../types';
import { useTeamMatchData } from '../../../hooks/useTeamMatchData';
import { useRoundLabel } from '../../../hooks/useRoundLabel';
import { useIntegrationFor } from '../../../integrations/registry';
import { MatchMapChips } from '../../team/MatchMapChips';
import { MatchPlayerPerformance } from '../../team/MatchPlayerPerformance';
import { getMapData, getMapDisplayName } from '../../../constants/maps';
import { isVetoDisabledForMatch } from '../../../utils/matchFlags';
import { tokens, fontDisplay, mono, radii, withAlpha } from '../../../theme/tokens';

const { color } = tokens;
const FORMATS = ['bo1', 'bo3', 'bo5'];

type Phase = 'notStarted' | 'waitingOpponent' | 'veto' | 'joining' | 'live' | 'done';

/** Where the match stands, in the order the tab draws it (boards 7a–7c). */
function phaseOf(match: TeamMatchInfo, tournamentStatus: string): Phase {
  const isManual = match.round === 0;
  const bothTeams = isManual
    ? Boolean(match.config?.team1 && match.config?.team2)
    : Boolean(match.team1?.id && match.team2?.id);
  if (match.status === 'completed') return 'done';
  if (match.status === 'live' && match.liveStats && match.liveStats.status !== 'warmup') return 'live';
  if (!isManual && tournamentStatus !== 'in_progress' && match.status === 'pending') return 'notStarted';
  if (match.status === 'pending' && !bothTeams) return 'waitingOpponent';
  const vetoOff = isVetoDisabledForMatch({
    round: match.round,
    team1: match.team1 ? { id: match.team1.id } : null,
    team2: match.team2 ? { id: match.team2.id } : null,
    config: match.config
      ? {
          ...match.config,
          team1: match.config.team1 ? { id: match.config.team1.id } : null,
          team2: match.config.team2 ? { id: match.config.team2.id } : null,
        }
      : null,
  });
  const vetoDone = match.veto?.status === 'completed';
  if (!vetoOff && !vetoDone && match.status === 'pending' && FORMATS.includes(match.matchFormat)) {
    return 'veto';
  }
  return 'joining';
}

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

function TeamMark({ tag, name, highlight }: { tag?: string; name: string; highlight?: boolean }) {
  const text = (tag?.trim() || name.slice(0, 3)).slice(0, 4).toUpperCase();
  return (
    <Box
      component="span"
      sx={{
        width: { xs: 48, md: 64 },
        height: { xs: 48, md: 64 },
        flex: 'none',
        borderRadius: '16px',
        bgcolor: color.paper3,
        display: 'grid',
        placeItems: 'center',
        fontWeight: 700,
        fontSize: { xs: '0.75rem', md: '0.875rem' },
        color: highlight ? color.accent : color.ink2,
      }}
    >
      {text}
    </Box>
  );
}

/** One line saying what is happening now, with the action that goes with it. */
function StatusLine({
  tone,
  icon,
  title,
  detail,
  action,
}: {
  tone: string;
  icon: ReactNode;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <Box
      data-testid="your-match-status"
      sx={{
        display: 'flex',
        flexWrap: { xs: 'wrap', md: 'nowrap' },
        alignItems: 'center',
        gap: 2,
        p: '16px 20px',
        borderRadius: '16px',
        bgcolor: withAlpha(tone, 0.14),
      }}
    >
      <Box sx={{ color: tone, display: 'flex' }} aria-hidden>
        {icon}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 180 }}>
        <Typography sx={{ fontWeight: 600, fontSize: '1rem' }}>{title}</Typography>
        {detail && <Typography sx={{ fontSize: '0.875rem', color: color.ink2 }}>{detail}</Typography>}
      </Box>
      {action}
    </Box>
  );
}

/** A side's players: a face, the name, and whether they are in the server. */
function InServerList({
  players,
  connected,
}: {
  players: Array<{ steamid: string; name: string; avatar?: string }>;
  connected: Set<string>;
}) {
  const { t } = useTranslation();
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {players.map((player) => {
        const isIn = connected.has(player.steamid);
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
            <Typography sx={{ flex: 1, minWidth: 0, color: isIn ? color.ink : color.muted, overflowWrap: 'anywhere' }}>
              {player.name}
            </Typography>
            <Typography sx={{ fontSize: '0.8125rem', color: isIn ? color.live : color.muted, whiteSpace: 'nowrap' }}>
              {isIn ? t('yourMatch.inServer') : t('yourMatch.notJoined')}
            </Typography>
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
 * server, or the scoreboard. The maps of the series sit at the bottom.
 *
 * The veto, the join button and the scoreboard are the same pieces the team's
 * match page (`/team/:teamId`) uses, so both always show the same thing.
 */
export function YourMatchCard({ teamId }: { teamId: string }) {
  const { t } = useTranslation();
  const { team, match, hasMatch, loading, tournamentStatus, loadTeamMatch } = useTeamMatchData(teamId);
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

  if (!hasMatch || !match) {
    return (
      <Box data-testid="your-match-none" sx={{ p: 3, borderRadius: radii.lg, bgcolor: color.paper2, border: `1px solid ${color.rule}` }}>
        <Typography sx={{ fontWeight: 600 }}>
          {tournamentStatus === 'completed' ? t('teamPage.tournamentFinished') : t('teamPage.noMatchNow')}
        </Typography>
        <Typography sx={{ color: color.ink2, mt: 0.5, fontSize: '0.875rem' }}>
          {tournamentStatus === 'completed' ? '' : t('teamPage.noMatchNowHint')}
        </Typography>
      </Box>
    );
  }

  const phase = phaseOf(match, tournamentStatus);
  const viewerIsMember = match.viewerIsTeamMember !== false;
  const us = match.isTeam1 ? 'team1' : 'team2';
  const them = match.isTeam1 ? 'team2' : 'team1';
  const ourName = team?.name ?? match[us]?.name ?? match.config?.[us]?.name ?? '';
  const theirName = match.opponent?.name ?? match.config?.[them]?.name ?? t('home.tbd');
  const ourTag = team?.tag ?? match[us]?.tag ?? match.config?.[us]?.tag;
  const theirTag = match.opponent?.tag ?? match.config?.[them]?.tag;

  const live = match.liveStats;
  const mapKey = phase === 'veto' ? null : (live?.mapName ?? match.currentMap ?? null);
  const mapImage = mapKey ? getMapData(mapKey)?.image : undefined;
  const mapNumber = live?.mapNumber ?? match.mapNumber ?? null;
  const totalMaps = live?.totalMaps ?? match.maps?.length ?? null;

  const wins = seriesWins(match);
  const ourMaps = wins[us];
  const theirMaps = wins[them];
  const ourRounds = live ? (match.isTeam1 ? live.team1Score : live.team2Score) : 0;
  const theirRounds = live ? (match.isTeam1 ? live.team2Score : live.team1Score) : 0;
  const formatLabel = t('yourMatch.bestOf', { count: Number(match.matchFormat.replace('bo', '')) || 1 });
  const roundLabel = match.round === 0 ? t('teamPage.manualMatch') : getRoundLabel(match.round);

  const connected = new Set((match.connectionStatus?.connectedPlayers ?? []).map((p) => p.steamId));
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
  const team1Now = team1Starts === null ? null : swapped ? (team1Starts === 'CT' ? 'T' : 'CT') : team1Starts;
  const ourSide = team1Now === null ? null : match.isTeam1 ? team1Now : team1Now === 'CT' ? 'T' : 'CT';
  const theirSide = ourSide === null ? null : ourSide === 'CT' ? 'T' : 'CT';

  const join = ConnectPanel && viewerIsMember ? (
    <Box sx={{ width: '100%' }}>
      <ConnectPanel matchSlug={match.slug} viewerCanJoin={viewerIsMember} matchStatus={match.status} />
    </Box>
  ) : null;

  const score =
    phase === 'live' ? (
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2 }} data-testid="your-match-score">
        <Typography sx={{ fontFamily: fontDisplay, fontSize: { xs: '2.5rem', md: '3.5rem' }, fontWeight: 700, lineHeight: 1 }}>
          {ourRounds}
        </Typography>
        <Typography sx={{ fontSize: '1.5rem', color: color.muted }}>:</Typography>
        <Typography sx={{ fontFamily: fontDisplay, fontSize: { xs: '2.5rem', md: '3.5rem' }, fontWeight: 700, lineHeight: 1 }}>
          {theirRounds}
        </Typography>
      </Box>
    ) : (
      <Typography
        data-testid="your-match-score"
        sx={{ fontFamily: fontDisplay, fontSize: { xs: '2rem', md: '2.5rem' }, fontWeight: 700 }}
      >
        {ourMaps} – {theirMaps}
      </Typography>
    );
  const scoreLine =
    phase === 'live'
      ? t('yourMatch.mapsScore', { us: ourMaps, them: theirMaps })
      : [roundLabel, formatLabel].filter(Boolean).join(' · ');

  let body: ReactNode = null;
  if (phase === 'notStarted') {
    body = <StatusLine tone={color.muted} icon={<ClockIcon size={24} />} title={t('matchInfo.waitingForTournamentTitle')} detail={t('matchInfo.waitingForTournamentBody')} />;
  } else if (phase === 'waitingOpponent') {
    body = <StatusLine tone={color.muted} icon={<ClockIcon size={24} />} title={t('matchInfo.waitingForOpponentTitle')} detail={t('matchInfo.waitingForOpponentBody')} />;
  } else if (phase === 'veto') {
    body = PreMatchView && viewerIsMember ? (
      <PreMatchView
        matchSlug={match.slug}
        team1Name={match.team1?.name ?? match.config?.team1?.name}
        team2Name={match.team2?.name ?? match.config?.team2?.name}
        currentTeamSlug={team?.id ?? us}
        onComplete={onVetoComplete}
        hideMatchHeader
      />
    ) : (
      <StatusLine tone={color.accent} icon={<ClockIcon size={24} />} title={t('yourMatch.vetoTitle')} />
    );
  } else if (phase === 'joining') {
    body = (
      <>
        <StatusLine
          tone={color.sideT}
          icon={<UsersThreeIcon size={24} />}
          title={t('yourMatch.waitingForPlayers')}
          detail={t('yourMatch.inServerCount', { count: inServer, expected })}
        />
        {join}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'repeat(2, minmax(0,1fr))' }, gap: { xs: 2, md: 5 } }}>
          <InServerList players={match.config?.[us]?.players ?? []} connected={connected} />
          <InServerList players={match.config?.[them]?.players ?? []} connected={connected} />
        </Box>
      </>
    );
  } else if (phase === 'live') {
    body = (
      <>
        <StatusLine
          tone={color.live}
          icon={<PlayCircleIcon size={24} />}
          title={t('yourMatch.live')}
          detail={live?.roundNumber ? t('yourMatch.round', { n: live.roundNumber }) : undefined}
        />
        {join}
        {join && (
          <Typography sx={{ fontSize: '0.8125rem', color: color.muted, mt: -1.5 }} data-testid="your-match-rejoin">
            {t('yourMatch.rejoin')}
          </Typography>
        )}
        {live?.playerStats && (
          <MatchPlayerPerformance
            playerStats={live.playerStats}
            teamName={ourName}
            opponentName={theirName}
            yourTeamIsTeam1={match.isTeam1}
          />
        )}
      </>
    );
  } else {
    // Over: who won, by how much (draft 7c); the maps and demos follow below.
    const outcome = ourMaps > theirMaps ? 'won' : ourMaps < theirMaps ? 'lost' : 'draw';
    body = (
      <StatusLine
        tone={outcome === 'won' ? color.live : outcome === 'lost' ? color.ban : color.muted}
        icon={outcome === 'won' ? <TrophyIcon size={24} /> : <ClockIcon size={24} />}
        title={t(`yourMatch.outcome.${outcome}`, { us: ourMaps, them: theirMaps, opponent: theirName })}
        detail={t('yourMatch.finished')}
      />
    );
  }

  return (
    <Box
      data-testid="your-match"
      data-phase={phase}
      sx={{ borderRadius: radii.lg, bgcolor: color.paper2, border: `1px solid ${color.rule}`, overflow: 'hidden' }}
    >
      {mapKey && (
        <Box
          data-testid="your-match-map"
          sx={{
            height: { xs: 140, md: 200 },
            position: 'relative',
            display: 'flex',
            alignItems: 'flex-end',
            bgcolor: color.paper3,
            backgroundImage: mapImage ? `url("${mapImage}")` : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <Box sx={{ m: { xs: 1.5, md: '20px 24px' }, px: 2, py: 1.25, borderRadius: '14px', bgcolor: withAlpha(color.paper, 0.82), display: 'flex', alignItems: 'center', gap: 1.75 }}>
            <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.375rem', fontWeight: 700 }}>
              {getMapDisplayName(mapKey)}
            </Typography>
            {typeof mapNumber === 'number' && totalMaps ? (
              <Typography sx={{ ...mono, fontSize: '0.75rem', color: color.ink2, textTransform: 'uppercase' }}>
                {t('yourMatch.mapOf', { n: mapNumber + 1, total: totalMaps })}
              </Typography>
            ) : null}
          </Box>
        </Box>
      )}

      <Box sx={{ p: { xs: 2.5, md: 3.5 }, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', alignItems: 'center', gap: { xs: 1.5, md: 3 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
            <TeamMark tag={ourTag} name={ourName} highlight />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontFamily: fontDisplay, fontSize: { xs: '1.125rem', md: '1.625rem' }, fontWeight: 700, overflowWrap: 'anywhere' }}>
                {ourName}
              </Typography>
              {phase === 'live' && ourSide && (
                <Typography data-testid="your-match-side" sx={{ ...mono, fontSize: '0.75rem', color: ourSide === 'CT' ? color.info : color.sideT }}>
                  {t('yourMatch.sideYou', { side: ourSide })}
                </Typography>
              )}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
            {score}
            <Typography sx={{ ...mono, fontSize: '0.75rem', color: color.muted, textTransform: 'uppercase', textAlign: 'center' }}>
              {scoreLine}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end', minWidth: 0 }}>
            <Box sx={{ minWidth: 0, textAlign: 'right' }}>
              <Typography sx={{ fontFamily: fontDisplay, fontSize: { xs: '1.125rem', md: '1.625rem' }, fontWeight: 700, textAlign: 'right', overflowWrap: 'anywhere' }}>
                {theirName}
              </Typography>
              {phase === 'live' && theirSide && (
                <Typography sx={{ ...mono, fontSize: '0.75rem', color: theirSide === 'CT' ? color.info : color.sideT }}>{theirSide}</Typography>
              )}
            </Box>
            <TeamMark tag={theirTag} name={theirName} />
          </Box>
        </Box>

        {body}

        {phase !== 'veto' && match.maps?.length > 0 && (
          <Box sx={{ pt: 2.25, borderTop: `1px solid ${color.rule}` }}>
            <MatchMapChips match={match} currentMapNumber={mapNumber} />
          </Box>
        )}
      </Box>
    </Box>
  );
}
