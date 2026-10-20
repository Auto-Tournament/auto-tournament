/**
 * Every player in the tournament by rating (the drafts' "Players · by rating"):
 * avatar, name, team logo, rating and its change, K / D, ADR and win rate,
 * with search and a CSV or JSON export. On a phone the team name, change,
 * K / D and win rate drop out; the avatar and the team logo stay.
 */
import { OpponentName } from '../../team/MatchRowLinks';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Menu, MenuItem, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../../../utils/api';
import { getPlayerPageUrl } from '../../../utils/playerLinks';
import { tokens, mono, radii, textSize } from '../../../theme/tokens';
import { PlayerAvatar, SectionTitle, TeamLogo, panel } from '../ui/draftUi';

const { color } = tokens;

interface Entry {
  playerId: string;
  name: string;
  avatar?: string;
  currentElo: number;
  eloChange: number;
  /** This tournament's match rating (1.00 = average); null before a player has played. */
  rating?: number | null;
  matchWins: number | string;
  matchLosses: number | string;
  winRate: number;
  kills?: number;
  deaths?: number;
  averageAdr?: number;
  adr?: number;
  team?: { id: string; name: string; tag?: string | null; logoUrl?: string | null } | null;
}

function download(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new window.Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function PlayersLeaderboard({
  tournamentId,
  viewerTeamId = null,
  limit,
  allTo,
  gameStats = true,
  sortBy = 'rating',
  testId = 'players-leaderboard',
  title,
}: {
  tournamentId: number | string;
  viewerTeamId?: string | null;
  limit?: number;
  allTo?: string;
  /** False for a game that measures no kills or damage: those columns drop out. */
  gameStats?: boolean;
  /** A shuffle ranks players by wins; everything else by rating. */
  sortBy?: 'rating' | 'wins';
  testId?: string;
  title?: string;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<{ leaderboard?: Entry[] }>(`/api/tournament/${tournamentId}/leaderboard`)
      .then((res) => live && setRows(res?.leaderboard ?? []))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [tournamentId]);

  const sorted = useMemo(
    () =>
      [...(rows ?? [])].sort((a, b) =>
        sortBy === 'wins'
          ? Number(b.matchWins) - Number(a.matchWins) ||
            Number(a.matchLosses) - Number(b.matchLosses) ||
            b.currentElo - a.currentElo
          : // How they play in this tournament, not their rating from before it (NTLAN 2026-10-17:
            // 60/24 at 133 ADR sat below players with a higher platform rating).
            (b.rating ?? -1) - (a.rating ?? -1) || b.currentElo - a.currentElo
      ),
    [rows, sortBy]
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? sorted.filter(
          (r) => r.name.toLowerCase().includes(q) || r.team?.name.toLowerCase().includes(q)
        )
      : sorted;
  }, [sorted, query]);
  if (!rows || rows.length === 0) return null;
  const shown = limit && !query ? filtered.slice(0, limit) : filtered;

  const exportAs = (kind: 'csv' | 'json') => {
    setMenu(null);
    const data = sorted.map((r, i) => ({
      rank: i + 1,
      player: r.name,
      team: r.team?.name ?? '',
      rating: r.rating ?? '',
      elo: r.currentElo,
      change: r.eloChange,
      kills: r.kills ?? '',
      deaths: r.deaths ?? '',
      adr: r.averageAdr ?? r.adr ?? '',
      winRate: Math.round((r.winRate ?? 0) * 100),
    }));
    if (kind === 'json')
      download('players.json', 'application/json', JSON.stringify(data, null, 2));
    else {
      const head = Object.keys(data[0]).join(',');
      const lines = data.map((d) =>
        Object.values(d)
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(',')
      );
      download('players.csv', 'text/csv', [head, ...lines].join('\n'));
    }
  };

  const cell = { py: 1.5, px: 1, borderTop: `1px solid ${color.rule}` } as const;
  const num = { ...cell, textAlign: 'right' as const, ...mono };
  const opt = { display: { xs: 'none', sm: 'table-cell' } } as const;
  const th = {
    py: 1,
    px: 1,
    fontSize: textSize.xs,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    color: color.muted,
    fontWeight: 600,
  };

  return (
    <Box component="section" aria-labelledby="players-lb" data-testid={testId} sx={panel}>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1.5,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <SectionTitle id="players-lb" title={title ?? t('liveOverview.players.title')} />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Box
            component="input"
            type="search"
            aria-label={t('liveOverview.players.find')}
            placeholder={t('liveOverview.players.find')}
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            sx={{
              minHeight: 44,
              borderRadius: radii.sm,
              border: `1px solid ${color.rule}`,
              bgcolor: color.paper3,
              color: color.ink,
              px: 1.5,
              font: 'inherit',
              '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 1 },
            }}
          />
          <Button
            variant="outlined"
            onClick={(e) => setMenu(e.currentTarget)}
            sx={{ minHeight: 44, borderRadius: radii.pill }}
          >
            {t('liveOverview.players.export')}
          </Button>
          <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
            <MenuItem onClick={() => exportAs('csv')}>CSV</MenuItem>
            <MenuItem onClick={() => exportAs('json')}>JSON</MenuItem>
          </Menu>
        </Box>
      </Box>
      <Box sx={{ overflowX: 'auto' }}>
        <Box
          component="table"
          sx={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9375rem' }}
        >
          <thead>
            <tr>
              <Box component="th" scope="col" sx={{ ...th, textAlign: 'left' }}>
                #
              </Box>
              <Box component="th" scope="col" sx={{ ...th, textAlign: 'left' }}>
                {t('liveOverview.players.player')}
              </Box>
              <Box component="th" scope="col" sx={{ ...th, textAlign: 'left' }}>
                {t('liveOverview.players.team')}
              </Box>
              {sortBy === 'wins' && (
                <Box component="th" scope="col" sx={{ ...th, textAlign: 'right' }}>
                  {t('liveOverview.wl')}
                </Box>
              )}
              <Box component="th" scope="col" sx={{ ...th, textAlign: 'right' }}>
                {t('liveOverview.players.rating')}
              </Box>
              <Box component="th" scope="col" sx={{ ...th, textAlign: 'right', ...opt }}>
                {t('liveOverview.players.change')}
              </Box>
              {gameStats && (
                <Box component="th" scope="col" sx={{ ...th, textAlign: 'right', ...opt }}>
                  {t('liveOverview.players.kd')}
                </Box>
              )}
              {gameStats && (
                <Box component="th" scope="col" sx={{ ...th, textAlign: 'right' }}>
                  {t('liveOverview.players.adr')}
                </Box>
              )}
              <Box component="th" scope="col" sx={{ ...th, textAlign: 'right', ...opt }}>
                {t('liveOverview.players.winRate')}
              </Box>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const rank = sorted.indexOf(r) + 1;
              const me = !!viewerTeamId && r.team?.id === viewerTeamId;
              const adr = r.averageAdr ?? r.adr;
              return (
                <Box
                  component="tr"
                  key={r.playerId}
                  sx={{ bgcolor: me ? color.paper3 : 'transparent' }}
                >
                  <Box component="td" sx={{ ...cell, ...mono, color: color.muted }}>
                    {rank}
                  </Box>
                  <Box component="td" sx={cell}>
                    <Box
                      component={RouterLink}
                      to={getPlayerPageUrl(r.playerId)}
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 1,
                        color: color.ink,
                        textDecoration: 'none',
                        fontWeight: me ? 700 : 500,
                        '&:hover': { textDecoration: 'underline' },
                      }}
                    >
                      <PlayerAvatar id={r.playerId} name={r.name} avatar={r.avatar} size={28} />
                      <span>{r.name}</span>
                    </Box>
                  </Box>
                  <Box component="td" sx={cell}>
                    {r.team ? (
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                        <TeamLogo team={r.team} size="sm" />
                        <Box
                          component="span"
                          sx={{ color: color.ink2, display: { xs: 'none', sm: 'inline' } }}
                        >
                          <OpponentName id={r.team.id} name={r.team.name} />
                        </Box>
                      </Box>
                    ) : (
                      <Box component="span" sx={{ color: color.muted }}>
                        —
                      </Box>
                    )}
                  </Box>
                  {sortBy === 'wins' && (
                    <Box component="td" sx={num}>
                      {r.matchWins}–{r.matchLosses}
                    </Box>
                  )}
                  <Box component="td" sx={num} title={`${r.currentElo}`}>
                    {sortBy === 'rating' && r.rating != null ? r.rating.toFixed(2) : r.currentElo}
                  </Box>
                  <Box
                    component="td"
                    sx={{
                      ...num,
                      ...opt,
                      color:
                        r.eloChange > 0 ? color.live : r.eloChange < 0 ? color.ban : color.ink2,
                    }}
                  >
                    {r.eloChange > 0 ? '+' : r.eloChange < 0 ? '−' : ''}
                    {Math.abs(r.eloChange)}
                  </Box>
                  {gameStats && (
                    <Box component="td" sx={{ ...num, ...opt }}>
                      {r.kills !== undefined && r.deaths !== undefined
                        ? `${r.kills} / ${r.deaths}`
                        : '—'}
                    </Box>
                  )}
                  {gameStats && (
                    <Box component="td" sx={num}>
                      {adr !== undefined && adr !== null ? Math.round(adr) : '—'}
                    </Box>
                  )}
                  <Box component="td" sx={{ ...num, ...opt }}>
                    {Math.round((r.winRate ?? 0) * 100)} %
                  </Box>
                </Box>
              );
            })}
          </tbody>
        </Box>
      </Box>
      {query && filtered.length === 0 && (
        <Typography sx={{ color: color.muted }}>{t('liveOverview.players.none')}</Typography>
      )}
      {limit && allTo && sorted.length > limit && !query && (
        <Box
          component={RouterLink}
          to={allTo}
          sx={{ alignSelf: 'flex-end', fontSize: '0.875rem', color: color.accent }}
        >
          {t('liveOverview.players.all', { count: sorted.length })}
        </Box>
      )}
    </Box>
  );
}

/** The shuffle's standings beside the round (the drafts): rank, face, name, record. */
export function ShuffleStandings({
  tournamentId,
  viewerSteamId,
  limit = 5,
  allTo,
}: {
  tournamentId: number;
  viewerSteamId: string | null;
  limit?: number;
  allTo: string;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Entry[] | null>(null);
  useEffect(() => {
    let live = true;
    api
      .get<{ leaderboard?: Entry[] }>(`/api/tournament/${tournamentId}/leaderboard`)
      .then((res) => live && setRows(res?.leaderboard ?? []))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [tournamentId]);
  if (!rows || rows.length === 0) return null;
  const sorted = [...rows].sort(
    (a, b) =>
      Number(b.matchWins) - Number(a.matchWins) ||
      Number(a.matchLosses) - Number(b.matchLosses) ||
      b.currentElo - a.currentElo
  );
  const medal = [color.medalGold, color.medalSilver, color.medalBronze];
  return (
    <Box
      component="section"
      aria-labelledby="shuffle-standings"
      data-testid="shuffle-standings"
      sx={{ ...panel, flex: '1 1 300px' }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <SectionTitle id="shuffle-standings" title={t('liveOverview.standings')} />
        <Box component={RouterLink} to={allTo} sx={{ fontSize: '0.875rem', color: color.accent }}>
          {t('liveOverview.players.all', { count: sorted.length })}
        </Box>
      </Box>
      <Box
        component="ol"
        sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}
      >
        {sorted.slice(0, limit).map((r, i) => {
          const me = r.playerId === viewerSteamId;
          return (
            <Box component="li" key={r.playerId}>
              {/* The whole row opens the player's page, like the full standings' names. */}
              <Box
                component={RouterLink}
                to={getPlayerPageUrl(r.playerId)}
                data-testid="shuffle-standings-player"
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '24px 32px minmax(0,1fr) auto',
                  gap: 1.25,
                  alignItems: 'center',
                  px: 1.5,
                  py: 1,
                  borderRadius: radii.sm,
                  bgcolor: me ? color.paper3 : 'transparent',
                  color: color.ink,
                  textDecoration: 'none',
                  '&:hover': { bgcolor: color.paper3 },
                  '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
                }}
              >
                <Typography
                  component="span"
                  sx={{ ...mono, fontWeight: 600, color: medal[i] ?? color.muted }}
                >
                  {i + 1}
                </Typography>
                <PlayerAvatar id={r.playerId} name={r.name} avatar={r.avatar} size={32} />
                <Typography
                  component="span"
                  sx={{ fontWeight: me ? 700 : 500, minWidth: 0, overflowWrap: 'anywhere' }}
                >
                  {r.name}
                </Typography>
                <Typography
                  component="span"
                  sx={{ ...mono, fontSize: '0.875rem', color: color.ink2 }}
                >
                  {r.matchWins}–{r.matchLosses}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
