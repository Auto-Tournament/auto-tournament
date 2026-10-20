/**
 * A team's next match as a link: "Team vs Opponent", where it stands, and one
 * button into its match room (`/match/:slug`). Home, the profile, the team
 * page and the tournament's Overview show this; only the room draws the veto,
 * the server and the score.
 */

import { OpponentName } from '../team/MatchRowLinks';
import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { TeamMatchInfo } from '../../types';
import { matchPagePath } from '../../paths';
import { matchPhaseOf, type MatchPhase } from '../../utils/matchPhase';
import { useSocket } from '../../hooks/useSocket';
import { onSocketReconnect } from '../../utils/socketResync';
import { tokens, fontDisplay } from '../../theme/tokens';
import { panelSx } from '../../components/common/ui';

const { color } = tokens;

const PHASE_KEY: Record<Exclude<MatchPhase, 'done'>, string> = {
  notStarted: 'matchInfo.waitingForTournamentTitle',
  waitingOpponent: 'matchInfo.waitingForOpponentTitle',
  veto: 'yourMatch.vetoTitle',
  joining: 'yourMatch.waitingForPlayers',
  live: 'yourMatch.live',
};

interface TeamMatchResponse {
  hasMatch?: boolean;
  match?: TeamMatchInfo | null;
  tournamentStatus?: string;
  team?: { name?: string } | null;
}

export function NextMatchCard({ teamId }: { teamId: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<TeamMatchResponse | null>(null);

  const load = useCallback(() => {
    let live = true;
    fetch(`/api/team/${encodeURIComponent(teamId)}/match`, { credentials: 'same-origin' })
      .then((res) => (res.ok ? (res.json() as Promise<TeamMatchResponse>) : null))
      .then((body) => live && setData(body))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [teamId]);

  useEffect(() => load(), [load]);

  // The phase moves on (veto, server, live): read it again when the match says so, or the
  // team moves on to its next match.
  const socket = useSocket();
  const slug = data?.match?.slug ?? null;
  useEffect(() => {
    // Any match or the bracket moving on, and after a reconnect, whatever was missed.
    const events = ['match:update', 'bracket:update', ...(slug ? [`veto:update:${slug}`] : [])];
    const changed = () => void load();
    for (const event of events) socket.on(event, changed);
    const offReconnect = onSocketReconnect(socket, changed);
    return () => {
      offReconnect();
      for (const event of events) socket.off(event, changed);
    };
  }, [socket, slug, load]);

  const match = data?.hasMatch ? (data.match ?? null) : null;
  if (!match?.slug) return null;
  const phase = matchPhaseOf(match, data?.tournamentStatus ?? '');
  if (phase === 'done') return null;

  const us = match.isTeam1 ? 'team1' : 'team2';
  const them = match.isTeam1 ? 'team2' : 'team1';
  const ourName = data?.team?.name ?? match[us]?.name ?? match.config?.[us]?.name ?? '';
  const theirName = match.opponent?.name ?? match.config?.[them]?.name ?? t('home.tbd');
  const ourId = teamId;
  const theirId = match.opponent?.id ?? null;
  const yourTurn = phase === 'veto';

  return (
    <Box
      component="section"
      aria-label={t('nextMatchCard.title')}
      data-testid="next-match-card"
      sx={{
        ...panelSx,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap',
        p: { xs: 2, md: 2.5 },
        border: `1px solid ${yourTurn ? color.accent : color.rule}`,
      }}
    >
      <Box sx={{ flex: '1 1 240px', minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: '0.75rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: color.muted,
          }}
        >
          {t('nextMatchCard.title')}
        </Typography>
        <Typography
          sx={{
            fontFamily: fontDisplay,
            fontWeight: 700,
            fontSize: '1.25rem',
            overflowWrap: 'anywhere',
          }}
        >
          <OpponentName id={ourId} name={ourName} /> {t('teamPage.versus')}{' '}
          <OpponentName id={theirId} name={theirName} />
        </Typography>
        <Typography sx={{ color: color.ink2, fontSize: '0.875rem' }} data-testid="next-match-phase">
          {t(PHASE_KEY[phase])}
        </Typography>
      </Box>
      <Button
        component={RouterLink}
        to={matchPagePath(match.slug)}
        variant={yourTurn || phase === 'joining' ? 'contained' : 'outlined'}
        data-testid="next-match-open"
        sx={{ minHeight: 44 }}
      >
        {t('nextMatchCard.open')}
      </Button>
    </Box>
  );
}
