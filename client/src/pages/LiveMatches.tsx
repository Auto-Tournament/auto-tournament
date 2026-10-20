/**
 * Live matches (`/manage/live`): every match on a server right now, one row
 * each, from `GET /api/game/cs2/live-overview`. The rows that need an admin
 * (an open call, a pause, a player missing from a live map) get a coloured
 * bar and come first. Kept fresh by `match:update` and the admin call events
 * (one read per second at most), with a 5 s poll behind them.
 */
import { OpponentName } from '../components/team/MatchRowLinks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Tooltip } from '@mui/material';
import { ChatCircleIcon, CheckIcon, XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { PageHead } from '../components/common/ui';
import { ManageCard, ManageTable, LevelText } from '../components/manage/ManageTable';
import { openChat } from '../components/chat/chatStore';
import { useAuth } from '../contexts/AuthContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useSocket } from '../hooks/useSocket';
import { onSocketReconnect } from '../utils/socketResync';
import { pageTitle } from '../utils/pageTitle';
import { api } from '../utils/api';
import { manageMatchPath, manageTournamentPath } from '../paths';
import { fontMono, radii, textSize, tokens } from '../theme/tokens';

const { color } = tokens;

const POLL_MS = 5_000;
const DEBOUNCE_MS = 1_000;

/** api/src/integrations/cs2/routes/liveOverview.ts `LiveOverviewMatch`. */
export interface LiveOverviewPlayer {
  steamId: string;
  name: string;
  connected: boolean;
  ready: boolean;
}

export interface LiveOverviewTeam {
  id: string | null;
  name: string;
  side: 'ct' | 't' | null;
  score: number;
  seriesScore: number;
  players: LiveOverviewPlayer[];
}

export interface LiveOverviewMatch {
  slug: string;
  status: string;
  source: 'tournament' | 'matchmaking' | 'manual';
  tournament: { id: number; name: string } | null;
  team1: LiveOverviewTeam;
  team2: LiveOverviewTeam;
  phase: string | null;
  map: { number: number; name: string | null } | null;
  numMaps: number | null;
  round: number | null;
  ready: { ready: number | null; total: number | null; required: number | null } | null;
  pause: {
    active: true;
    type: string | null;
    by: string | null;
    since: number | null;
    unpause: { team1: boolean; team2: boolean };
  } | null;
  call: {
    id: number;
    playerName: string | null;
    playerTeam: string | null;
    message: string;
    calledAt: string;
    claimedBy: string | null;
    claimedByName: string | null;
  } | null;
  server: { id: string; name: string | null; online: boolean | null } | null;
  updatedAt: number | null;
}

type Severity = 'call' | 'paused' | 'missing' | null;

const PLAYING_PHASES = new Set(['knife', 'side_pick', 'live', 'paused', 'halftime', 'overtime']);

function missingPlayers(m: LiveOverviewMatch): number {
  const playing = m.phase ? PLAYING_PHASES.has(m.phase) : m.status === 'live';
  if (!playing) return 0;
  return [...m.team1.players, ...m.team2.players].filter((p) => !p.connected).length;
}

/** What needs an admin, the most urgent first. */
export function severityOf(m: LiveOverviewMatch): Severity {
  if (m.call && !m.call.claimedBy) return 'call';
  if (m.pause || m.phase === 'paused') return 'paused';
  if (m.call) return 'call';
  if (missingPlayers(m) > 0) return 'missing';
  return null;
}

const SEVERITY_RANK: Record<Exclude<Severity, null>, number> = { call: 3, paused: 2, missing: 1 };

function severityRank(m: LiveOverviewMatch): number {
  const s = severityOf(m);
  // A claimed call is someone's already: below an unclaimed one, above a pause.
  if (s === 'call' && m.call?.claimedBy) return 2.5;
  return s ? SEVERITY_RANK[s] : 0;
}

/** The rows needing attention first; otherwise the API's order (live, then loaded). */
export function sortLive(matches: LiveOverviewMatch[]): LiveOverviewMatch[] {
  return matches
    .map((m, index) => ({ m, index }))
    .sort((a, b) => severityRank(b.m) - severityRank(a.m) || a.index - b.index)
    .map(({ m }) => m);
}

function stripeOf(m: LiveOverviewMatch): string | undefined {
  switch (severityOf(m)) {
    case 'call':
      return m.call?.claimedBy ? color.warning : color.ban;
    case 'paused':
      return color.warning;
    case 'missing':
      return color.accent;
    default:
      return undefined;
  }
}

function phaseColor(phase: string | null): string {
  switch (phase) {
    case 'live':
    case 'overtime':
      return color.live;
    case 'paused':
    case 'error':
      return color.ban;
    case 'knife':
    case 'side_pick':
      return color.accent;
    case 'halftime':
    case 'restoring':
      return color.warning;
    case 'warmup':
    case 'loading':
      return color.info;
    default:
      return color.muted;
  }
}

function sideColor(side: 'ct' | 't' | null): string {
  return side === 'ct' ? color.sideCt : side === 't' ? color.sideT : color.ink;
}

function elapsed(since: number | null, now: number): string | null {
  if (!since) return null;
  const s = Math.max(0, Math.floor(now / 1000 - since));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

const muted = (
  <Box component="span" sx={{ color: color.muted }}>
    —
  </Box>
);

function Dot({ on, title }: { on: boolean | null; title?: string }) {
  return (
    <Box
      component="span"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      sx={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: radii.pill,
        flexShrink: 0,
        bgcolor: on === null ? color.muted : on ? color.live : color.ban,
      }}
    />
  );
}

function PhaseChip({ phase }: { phase: string | null }) {
  const { t } = useTranslation();
  const c = phaseColor(phase);
  return (
    <Box
      component="span"
      data-testid="live-phase"
      data-phase={phase ?? 'none'}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 1,
        height: 22,
        borderRadius: radii.pill,
        border: `1px solid ${c}`,
        color: c,
        fontSize: textSize.xs,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {t(`liveMatchesPage.phase.${phase ?? 'none'}`, { defaultValue: phase ?? '—' })}
    </Box>
  );
}

function TeamPlayers({ team, label }: { team: LiveOverviewTeam; label: string }) {
  const { t } = useTranslation();
  const connected = team.players.filter((p) => p.connected).length;
  const ready = team.players.filter((p) => p.ready).length;
  const list = (
    <Box sx={{ display: 'grid', gap: 0.5, p: 0.5 }}>
      <Box sx={{ fontWeight: 600 }}>{team.name}</Box>
      {team.players.length === 0 && <Box>{t('liveMatchesPage.players.none')}</Box>}
      {team.players.map((p) => (
        <Box key={p.steamId} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Dot
            on={p.connected}
            title={
              p.connected
                ? t('liveMatchesPage.players.connected')
                : t('liveMatchesPage.players.disconnected')
            }
          />
          <Box component="span" sx={{ flex: 1 }}>
            {p.name}
          </Box>
          {p.ready && (
            <Box component="span" sx={{ color: color.live, fontSize: textSize.xs }}>
              {t('liveMatchesPage.players.readyTag')}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
  return (
    <Tooltip title={list} enterTouchDelay={0} leaveTouchDelay={6000} placement="bottom-start">
      <Box
        component="button"
        type="button"
        aria-label={`${label}: ${team.name}`}
        sx={{
          all: 'unset',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          whiteSpace: 'nowrap',
          '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
        }}
      >
        <Box component="span" sx={{ display: 'inline-flex', gap: '2px' }} aria-hidden>
          {team.players.map((p) => (
            <Dot key={p.steamId} on={p.connected} />
          ))}
        </Box>
        <Box
          component="span"
          sx={{ color: connected < team.players.length ? color.accent : color.ink2 }}
        >
          {t('liveMatchesPage.players.summary', {
            connected,
            total: team.players.length,
            ready,
          })}
        </Box>
      </Box>
    </Tooltip>
  );
}

function MatchLabel({ m }: { m: LiveOverviewMatch }) {
  const { t } = useTranslation();
  const where =
    m.tournament?.name ??
    (m.source === 'matchmaking'
      ? t('liveMatchesPage.source.matchmaking')
      : t('liveMatchesPage.source.manual'));
  return (
    <Box sx={{ display: 'grid', gap: 0.25, minWidth: 140 }}>
      <Box component="span" sx={{ color: color.ink2, whiteSpace: 'nowrap' }}>
        {m.tournament ? (
          <Box
            component={RouterLink}
            to={manageTournamentPath(m.tournament.id)}
            sx={{
              color: 'inherit',
              textDecoration: 'none',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            {where}
          </Box>
        ) : (
          where
        )}
      </Box>
      <Box
        component={RouterLink}
        to={manageMatchPath(m.slug, m.tournament?.id)}
        data-testid="live-match-link"
        sx={{ fontFamily: fontMono, fontSize: textSize.xs, color: color.accent }}
      >
        {m.slug}
      </Box>
    </Box>
  );
}

function Score({ m }: { m: LiveOverviewMatch }) {
  const series = (m.numMaps ?? 1) > 1;
  return (
    <Box sx={{ display: 'grid', gap: 0.25, whiteSpace: 'nowrap' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
        <Box component="span" sx={{ color: sideColor(m.team1.side), fontWeight: 600 }}>
          <OpponentName id={m.team1.id} name={m.team1.name} />
        </Box>
        <Box
          component="span"
          data-testid="live-score"
          sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}
        >
          <Box component="span" sx={{ color: sideColor(m.team1.side) }}>
            {m.team1.score}
          </Box>
          –
          <Box component="span" sx={{ color: sideColor(m.team2.side) }}>
            {m.team2.score}
          </Box>
        </Box>
        <Box component="span" sx={{ color: sideColor(m.team2.side), fontWeight: 600 }}>
          <OpponentName id={m.team2.id} name={m.team2.name} />
        </Box>
      </Box>
      {series && (
        <Box
          component="span"
          sx={{ color: color.muted, fontSize: textSize.xs, fontVariantNumeric: 'tabular-nums' }}
        >
          {`Bo${m.numMaps} · ${m.team1.seriesScore}–${m.team2.seriesScore}`}
        </Box>
      )}
    </Box>
  );
}

function Pause({ m, now }: { m: LiveOverviewMatch; now: number }) {
  const { t } = useTranslation();
  if (!m.pause) return muted;
  const time = elapsed(m.pause.since, now);
  const flag = (team: LiveOverviewTeam, on: boolean) => (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        color: on ? color.live : color.muted,
      }}
    >
      {on ? <CheckIcon size={12} aria-hidden /> : <XIcon size={12} aria-hidden />}
      {team.name}
    </Box>
  );
  return (
    <Box data-testid="live-pause" sx={{ display: 'grid', gap: 0.25, whiteSpace: 'nowrap' }}>
      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'baseline' }}>
        <LevelText tone="warn">
          {t(`liveMatchesPage.pause.type.${m.pause.type ?? 'unknown'}`, {
            defaultValue: m.pause.type ?? t('liveMatchesPage.pause.type.unknown'),
          })}
        </LevelText>
        {time && (
          <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', color: color.ink2 }}>
            {time}
          </Box>
        )}
      </Box>
      {m.pause.by && (
        <Box component="span" sx={{ color: color.muted, fontSize: textSize.xs }}>
          {t('liveMatchesPage.pause.by', { name: m.pause.by })}
        </Box>
      )}
      <Box
        sx={{ display: 'flex', gap: 1, fontSize: textSize.xs }}
        aria-label={t('liveMatchesPage.pause.unpause')}
      >
        {flag(m.team1, m.pause.unpause.team1)}
        {flag(m.team2, m.pause.unpause.team2)}
      </Box>
    </Box>
  );
}

function Call({
  m,
  onClaim,
  busy,
}: {
  m: LiveOverviewMatch;
  onClaim: (id: number) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const { playerSteamId } = useAuth();
  const call = m.call;
  if (!call) return muted;
  const mine = !!call.claimedBy && call.claimedBy === playerSteamId;
  return (
    <Box data-testid="live-call" sx={{ display: 'grid', gap: 0.5, minWidth: 180, maxWidth: 260 }}>
      <Tooltip title={call.message || t('liveMatchesPage.call.noMessage')}>
        <Box
          component="span"
          sx={{
            display: 'inline-block',
            px: 1,
            py: 0.25,
            borderRadius: radii.sm,
            bgcolor: call.claimedBy ? 'transparent' : color.ban,
            border: `1px solid ${call.claimedBy ? color.warning : color.ban}`,
            color: call.claimedBy ? color.warning : color.paper,
            fontWeight: 600,
            fontSize: textSize.xs,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {call.playerName ? `${call.playerName}: ` : ''}
          {call.message || t('liveMatchesPage.call.noMessage')}
        </Box>
      </Tooltip>
      {call.claimedBy ? (
        <Box component="span" sx={{ color: color.muted, fontSize: textSize.xs }}>
          {mine
            ? t('adminCalls.claimedByYou')
            : t('adminCalls.claimedBy', { name: call.claimedByName || t('adminCalls.anAdmin') })}
        </Box>
      ) : (
        <Button
          size="small"
          variant="contained"
          color="error"
          disabled={busy}
          onClick={() => onClaim(call.id)}
          data-testid="live-call-claim"
          sx={{ justifySelf: 'start', whiteSpace: 'nowrap' }}
        >
          {t('adminCalls.claim')}
        </Button>
      )}
    </Box>
  );
}

export default function LiveMatches() {
  const { t } = useTranslation();
  const { showError } = useSnackbar();
  const socket = useSocket();
  const [matches, setMatches] = useState<LiveOverviewMatch[] | null>(null);
  const [error, setError] = useState(false);
  const [claiming, setClaiming] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    document.title = pageTitle(t('liveMatchesPage.title'));
  }, [t]);

  const load = useCallback(async () => {
    try {
      const body = await api.get<{ matches?: LiveOverviewMatch[] }>('/api/game/cs2/live-overview');
      setMatches(body.matches ?? []);
      setError(false);
    } catch {
      setError(true);
      setMatches((prev) => prev ?? []);
    }
  }, []);

  // Socket events, at most one read a second.
  const debounce = useRef<number | null>(null);
  const refresh = useCallback(() => {
    if (debounce.current !== null) return;
    debounce.current = window.setTimeout(() => {
      debounce.current = null;
      void load();
    }, DEBOUNCE_MS);
  }, [load]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      window.clearInterval(id);
      if (debounce.current !== null) window.clearTimeout(debounce.current);
      debounce.current = null;
    };
  }, [load]);

  useEffect(() => {
    // The admin call events reach the admin room only.
    const subscribe = () => socket.emit('admin:subscribe');
    const events = ['match:update', 'admin:call', 'admin:call:claimed', 'admin:call:resolved'];
    socket.on('connect', subscribe);
    events.forEach((e) => socket.on(e, refresh));
    if (socket.connected) subscribe();
    const offReconnect = onSocketReconnect(socket, () => void load());
    return () => {
      offReconnect();
      socket.off('connect', subscribe);
      events.forEach((e) => socket.off(e, refresh));
    };
  }, [socket, refresh, load]);

  // The pause timers count.
  const anyPause = matches?.some((m) => m.pause) ?? false;
  useEffect(() => {
    if (!anyPause) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anyPause]);

  const claim = async (id: number) => {
    setClaiming(id);
    try {
      await api.post(`/api/admin-calls/${id}/claim`, {});
      await load();
    } catch {
      showError(t('adminCalls.resolveFailed'));
    } finally {
      setClaiming(null);
    }
  };

  const rows = useMemo(() => sortLive(matches ?? []), [matches]);

  return (
    <Box data-testid="live-matches-page" sx={{ width: '100%' }}>
      <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <PageHead
          title={t('liveMatchesPage.title')}
          subtitle={t('liveMatchesPage.subtitle')}
          sx={{ mb: 0 }}
        />
        <ManageCard sx={{ p: { xs: 1, md: 2 } }}>
          {error && <LevelText tone="error">{t('liveMatchesPage.loadFailed')}</LevelText>}
          <ManageTable
            data-testid="live-matches-table"
            label={t('liveMatchesPage.title')}
            sx={{ '& table': { minWidth: 1100 } }}
            columns={[
              { key: 'match', label: t('liveMatchesPage.columns.match') },
              { key: 'map', label: t('liveMatchesPage.columns.map') },
              { key: 'phase', label: t('liveMatchesPage.columns.phase') },
              { key: 'score', label: t('liveMatchesPage.columns.score') },
              { key: 'round', label: t('liveMatchesPage.columns.round'), numeric: true },
              { key: 'players', label: t('liveMatchesPage.columns.players') },
              { key: 'pause', label: t('liveMatchesPage.columns.pause') },
              { key: 'call', label: t('liveMatchesPage.columns.call') },
              { key: 'server', label: t('liveMatchesPage.columns.server') },
              { key: 'chat', label: t('liveMatchesPage.columns.chat'), hidden: true },
            ]}
            empty={
              matches === null ? (
                t('liveMatchesPage.loading')
              ) : (
                <Box data-testid="live-matches-empty">{t('liveMatchesPage.empty')}</Box>
              )
            }
            rows={rows.map((m) => {
              const severity = severityOf(m);
              return {
                key: m.slug,
                testId: `live-row-${m.slug}`,
                stripe: stripeOf(m),
                data: { 'data-severity': severity ?? 'none' },
                cells: [
                  <MatchLabel key="m" m={m} />,
                  <Box key="map" sx={{ display: 'grid', gap: 0.25, whiteSpace: 'nowrap' }}>
                    <span>{m.map?.name ?? '—'}</span>
                    {m.map && (
                      <Box component="span" sx={{ color: color.muted, fontSize: textSize.xs }}>
                        {t('liveMatchesPage.mapOf', {
                          n: m.map.number,
                          total: m.numMaps ?? m.map.number,
                        })}
                      </Box>
                    )}
                  </Box>,
                  <PhaseChip key="p" phase={m.phase} />,
                  <Score key="s" m={m} />,
                  m.round ?? muted,
                  <Box key="pl" sx={{ display: 'grid', gap: 0.5 }}>
                    <TeamPlayers team={m.team1} label={t('liveMatchesPage.columns.players')} />
                    <TeamPlayers team={m.team2} label={t('liveMatchesPage.columns.players')} />
                  </Box>,
                  <Pause key="pa" m={m} now={now} />,
                  <Call key="c" m={m} onClaim={(id) => void claim(id)} busy={claiming !== null} />,
                  m.server ? (
                    <Box
                      key="sv"
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <Dot
                        on={m.server.online}
                        title={
                          m.server.online === null
                            ? t('liveMatchesPage.server.unknown')
                            : m.server.online
                              ? t('liveMatchesPage.server.online')
                              : t('liveMatchesPage.server.offline')
                        }
                      />
                      <span>{m.server.name ?? m.server.id}</span>
                    </Box>
                  ) : (
                    muted
                  ),
                  <Button
                    key="ch"
                    size="small"
                    variant="outlined"
                    startIcon={<ChatCircleIcon aria-hidden />}
                    onClick={() =>
                      openChat(`match:${m.slug}`, `${m.team1.name} vs ${m.team2.name}`)
                    }
                    data-testid="live-chat"
                    sx={{ whiteSpace: 'nowrap' }}
                  >
                    {t('liveMatchesPage.chat')}
                  </Button>,
                ],
              };
            })}
          />
        </ManageCard>
      </Box>
    </Box>
  );
}
