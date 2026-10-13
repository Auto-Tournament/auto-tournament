import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { DotsThreeIcon } from '@phosphor-icons/react';
import { api } from '../utils/api';
import { useSocket } from '../hooks/useSocket';
import { useSnackbar } from '../contexts/SnackbarContext';
import { openChat } from '../components/chat/chatStore';
import { ConfirmAction, type ConfirmActionSpec } from '../components/manage/match/ConfirmAction';
import { manageTournamentPath } from '../paths';
import { MatchHoldPanel } from '../components/admin/MatchHoldPanel';
import { FleetRosterEditor } from '../components/admin/FleetRosterEditor';
import { useIntegrationFor } from '../integrations/registry';
import { fontDisplay, fontMono, radii, textSize, tokens } from '../theme/tokens';

const { color } = tokens;

// ---- the API's shape (api/src/integrations/cs2/routes/manageMatch.ts) ----

interface LivePlayer {
  name?: string;
  role?: string;
  connected: boolean;
  ready: boolean;
  alive?: boolean;
}
interface LiveTeam {
  name: string;
  side?: 'ct' | 't' | 'CT' | 'T';
  score: number;
  players: Record<string, LivePlayer>;
}
interface LiveMap {
  name: string;
  status: 'pending' | 'live' | 'done';
  score?: { team1: number; team2: number };
  winner?: 'team1' | 'team2' | 'none';
  demo?: { state: string };
}
interface LiveState {
  phase: string;
  series: {
    num_maps: number;
    current_map: number;
    score: { team1: number; team2: number };
    maps: Record<string, LiveMap>;
  };
  teams: { team1: LiveTeam; team2: LiveTeam };
  spectators?: Record<string, { name?: string; connected: boolean }>;
  pause?: { active: boolean; type?: string; by?: string; started_at?: number };
  round?: { number: number };
}
interface RoundPlayer {
  id: string;
  team: 0 | 1 | 2;
  kills: number;
  damage: number;
  died: boolean;
  money_start?: number;
  money_after_buy?: number;
  armor?: number;
  helmet?: boolean;
  defuser?: boolean;
  loadout?: string[];
}
interface RoundSummary {
  round_number: number;
  winner_team: 0 | 1 | 2;
  reason: number;
  team1_score: number;
  team2_score: number;
  team1_was_ct: boolean;
  players: RoundPlayer[];
}
interface LogEntry {
  at: number;
  level: 'error' | 'warn' | 'info' | 'admin';
  source: 'platform' | 'server' | 'admin';
  type: string;
  text: string;
  by: string | null;
}
interface ManageView {
  match: {
    slug: string;
    status: string;
    tournamentId: number | null;
    round: number;
    matchNumber: number | null;
    team1: { id: string | null; name: string | null };
    team2: { id: string | null; name: string | null };
  };
  server: {
    id: string;
    name: string | null;
    fleet: boolean;
    online: boolean | null;
    phase: string | null;
  } | null;
  live: {
    state: LiveState | null;
    mapRounds: Record<string, RoundSummary[]>;
    updatedAt: number;
  } | null;
  log: LogEntry[];
}

// ---- small pieces ----

const card = {
  bgcolor: color.paper2,
  border: `1px solid ${color.rule}`,
  borderRadius: radii.lg,
  p: { xs: 2, md: 2.5 },
  display: 'grid',
  gap: 1.5,
} as const;

const th = {
  textAlign: 'left',
  fontWeight: 500,
  color: color.muted,
  fontSize: textSize.sm,
  py: 1,
  px: 1.5,
  borderBottom: `1px solid ${color.rule}`,
} as const;
const td = {
  py: 1.25,
  px: 1.5,
  borderBottom: `1px solid ${color.paper3}`,
  fontSize: textSize.md,
  verticalAlign: 'middle',
} as const;

function Section({
  title,
  aside,
  children,
  testId,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Box component="section" aria-label={title} sx={card} data-testid={testId}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Typography
          component="h2"
          sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: '1.2rem' }}
        >
          {title}
        </Typography>
        {aside}
      </Box>
      {children}
    </Box>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box role="group" aria-label={label} sx={{ display: 'grid', gap: 0.75 }}>
      <Typography
        sx={{
          fontFamily: fontMono,
          fontSize: '0.7rem',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: color.muted,
        }}
      >
        {label}
      </Typography>
      <ButtonGroup variant="outlined" sx={{ flexWrap: 'wrap' }}>
        {children}
      </ButtonGroup>
    </Box>
  );
}

function Target({
  dot,
  title,
  who,
  state,
  children,
}: {
  dot: string;
  title: string;
  who: string;
  state?: string;
  children: ReactNode;
}) {
  return (
    <Box sx={card}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: dot }} />
        <Typography
          component="h3"
          sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: '1.1rem' }}
        >
          {title}
        </Typography>
        <Typography sx={{ color: color.muted, fontSize: textSize.sm }}>{who}</Typography>
        {state && (
          <Typography
            sx={{ ml: 'auto', fontFamily: fontMono, fontSize: textSize.xs, color: color.ink2 }}
          >
            {state}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {children}
      </Box>
    </Box>
  );
}

const mapLabel = (m: string | undefined) => {
  const bare = (m ?? '')
    .replace(/^.*\//, '')
    .replace(/^(de|cs|ar|dz)_/, '')
    .replace(/_/g, ' ');
  return bare ? bare.charAt(0).toUpperCase() + bare.slice(1) : '—';
};
const clock = (unix: number) =>
  new Date(unix * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
const LEVEL_COLOR: Record<LogEntry['level'], string> = {
  error: tokens.color.ban,
  warn: tokens.color.warning,
  info: tokens.color.ink2,
  admin: '#c9a7ff',
};
const money = (v: number | undefined) =>
  typeof v === 'number' && v >= 0 ? `$${v.toLocaleString()}` : '—';
const WEAPON_NAMES: Record<string, string> = {
  smokegrenade: 'smoke',
  flashbang: 'flash',
  hegrenade: 'HE',
  molotov: 'molotov',
  incgrenade: 'incendiary',
  decoy: 'decoy',
  m4a1_silencer: 'M4A1-S',
  usp_silencer: 'USP-S',
  taser: 'Zeus',
  c4: 'bomb',
};
const weaponLabel = (w: string) => WEAPON_NAMES[w] ?? w.toUpperCase().replace(/_/g, ' ');
const armourLabel = (p: { armor?: number; helmet?: boolean; defuser?: boolean }) => {
  if (typeof p.armor !== 'number' || p.armor < 0) return '—';
  const parts = [p.armor > 0 ? (p.helmet ? 'Kevlar + helmet' : 'Kevlar') : 'None'];
  if (p.defuser) parts.push('kit');
  return parts.join(', ');
};
const ROUND_REASON: Record<number, string> = {
  1: 'bomb exploded',
  7: 'bomb defused',
  8: 'elimination',
  9: 'elimination',
  12: 'time ran out',
};

// ---- the page ----

/**
 * An admin runs one match from here (/manage/tournaments/:id/matches/:slug):
 * who is on the server, the round, the server, every Ready Up command grouped
 * by what receives it, the maps, the rounds (with restore) and the logs.
 * Every action asks first (ConfirmAction).
 */
export default function ManageMatch() {
  const { slug = '', id = '' } = useParams<{ slug: string; id: string }>();
  const socket = useSocket();
  const { showError, showSuccess } = useSnackbar();
  const [view, setView] = useState<ManageView | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmActionSpec | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [levels, setLevels] = useState<string[]>(['error', 'warn', 'info', 'admin']);
  const [source, setSource] = useState<'all' | 'server' | 'platform' | 'admin'>('all');
  const [command, setCommand] = useState('status');
  const [commandReply, setCommandReply] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [menu, setMenu] = useState<{ anchor: HTMLElement; id: string; name: string } | null>(null);
  // The game module's own admin view (CS2: failover and round backups).
  const integration = useIntegrationFor({ game: 'cs2' });
  const ModulePanel = integration.matchPanels.adminMatchView;

  const load = useCallback(async () => {
    try {
      const res = await api.get<ManageView & { success: boolean }>(
        `/api/game/cs2/matches/${encodeURIComponent(slug)}/manage`
      );
      setView(res);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live: every change to the match or its server reloads the view.
  useEffect(() => {
    const changed = () => void load();
    const up = () => setConnected(true);
    const down = () => setConnected(false);
    const events = [
      'match:update',
      'bracket:update',
      'veto:update',
      'admin:call',
      'admin:call:resolved',
    ];
    for (const e of events) socket.on(e, changed);
    socket.on('connect', up);
    socket.on('disconnect', down);
    // The round, score and players change between match events too.
    const timer = window.setInterval(changed, 5000);
    return () => {
      for (const e of events) socket.off(e, changed);
      socket.off('connect', up);
      socket.off('disconnect', down);
      window.clearInterval(timer);
    };
  }, [socket, load]);

  const send = useCallback(
    async (name: string, args: Record<string, unknown> = {}, ok?: string) => {
      try {
        const res = await api.post<{
          success: boolean;
          error?: string;
          message?: string;
          response?: unknown;
        }>(`/api/game/cs2/matches/${encodeURIComponent(slug)}/manage/command`, { name, args });
        if (res && res.success === false) throw new Error(res.error || 'The server refused it');
        if (ok) showSuccess(ok);
        await load();
        // exec answers with the console lines it saw.
        const out = res?.response as { lines?: unknown; output?: unknown } | string | undefined;
        if (typeof out === 'string') return out;
        const lines = out?.lines ?? out?.output;
        return Array.isArray(lines) ? lines.join('\n') : typeof lines === 'string' ? lines : '';
      } catch (error) {
        showError((error as Error).message || 'The server refused it');
        throw error;
      }
    },
    [slug, load, showError, showSuccess]
  );

  const post = useCallback(
    async (url: string, body: Record<string, unknown>, ok: string) => {
      try {
        await api.post(url, body);
        showSuccess(ok);
        await load();
      } catch (error) {
        showError((error as Error).message || 'That did not work');
        throw error;
      }
    },
    [load, showError, showSuccess]
  );

  const state = view?.live?.state ?? null;
  const t1 = state?.teams.team1.name || view?.match.team1.name || 'Team 1';
  const t2 = state?.teams.team2.name || view?.match.team2.name || 'Team 2';
  const matchName = `${t1} vs ${t2}`;
  const currentMap = state ? state.series.maps[String(state.series.current_map)] : undefined;
  const rounds = useMemo(
    () => (state ? (view?.live?.mapRounds[String(state.series.current_map)] ?? []) : []),
    [state, view]
  );
  const shownRound = rounds.find((r) => r.round_number === selectedRound) ?? null;
  const live =
    state?.phase === 'live' || state?.phase === 'overtime' || state?.phase === 'halftime';
  const paused = state?.pause?.active === true || state?.phase === 'paused';
  const warmup = state?.phase === 'warmup' || state?.phase === 'loading';
  const onReadyUp = Boolean(view?.server?.fleet);
  const preServer = view ? ['pending', 'ready'].includes(view.match.status) && !view.server : false;
  const playerName = (pid: string) =>
    state?.teams.team1.players[pid]?.name || state?.teams.team2.players[pid]?.name || pid;

  if (failed && !view) {
    return <Alert severity="error">This match could not be loaded.</Alert>;
  }
  if (!view) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  const log = view.log.filter(
    (l) => levels.includes(l.level) && (source === 'all' || l.source === source)
  );
  const counts = {
    error: view.log.filter((l) => l.level === 'error').length,
    warn: view.log.filter((l) => l.level === 'warn').length,
  };

  const team = (key: 'team1' | 'team2') => {
    const tm = state?.teams[key];
    const players = Object.entries(tm?.players ?? {});
    const inGame = players.filter(([, p]) => p.connected).length;
    const side = (tm?.side ?? '').toUpperCase();
    return (
      <Box
        component="section"
        aria-label={tm?.name ?? key}
        sx={{
          ...card,
          borderTop: `3px solid ${side === 'CT' ? color.sideCt : side === 'T' ? color.sideT : color.rule}`,
        }}
        data-testid={`manage-team-${key}`}
      >
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
          <Typography
            component="h2"
            sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: '1.2rem' }}
          >
            {key === 'team1' ? t1 : t2}
          </Typography>
          {side && (
            <Typography sx={{ color: side === 'CT' ? color.sideCt : color.sideT }}>
              {side} this half
            </Typography>
          )}
          <Typography
            sx={{ ml: 'auto', color: inGame === players.length ? color.live : color.warning }}
          >
            {inGame} of {players.length} on the server
          </Typography>
        </Box>
        <Box sx={{ overflowX: 'auto' }}>
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Box component="th" scope="col" sx={th}>
                  Player
                </Box>
                <Box component="th" scope="col" sx={th}>
                  Role
                </Box>
                <Box component="th" scope="col" sx={th}>
                  Connection
                </Box>
                <Box component="th" scope="col" sx={th}>
                  Ready
                </Box>
                <Box component="th" scope="col" sx={th}>
                  Alive
                </Box>
                <Box component="th" scope="col" sx={th}>
                  <Box component="span" sx={{ position: 'absolute', left: -9999 }}>
                    Actions
                  </Box>
                </Box>
              </tr>
            </thead>
            <tbody>
              {players.map(([pid, p]) => (
                <tr key={pid}>
                  <Box component="td" sx={{ ...td, fontWeight: 500 }}>
                    {p.name || pid}
                  </Box>
                  <Box component="td" sx={{ ...td, color: color.muted }}>
                    {p.role ?? 'Player'}
                  </Box>
                  <Box component="td" sx={{ ...td, color: p.connected ? color.live : color.ban }}>
                    {p.connected ? 'Connected' : 'Not connected'}
                  </Box>
                  <Box component="td" sx={{ ...td, color: p.ready ? color.live : color.muted }}>
                    {p.ready ? 'Ready' : 'Not ready'}
                  </Box>
                  <Box component="td" sx={{ ...td, color: color.ink2 }}>
                    {p.alive === undefined ? '—' : p.alive ? 'Alive' : 'Dead'}
                  </Box>
                  <Box component="td" sx={{ ...td, textAlign: 'right' }}>
                    <IconButton
                      aria-label={`Actions for ${p.name || pid}`}
                      size="small"
                      disabled={!p.connected || !onReadyUp}
                      onClick={(e) =>
                        setMenu({ anchor: e.currentTarget, id: pid, name: p.name || pid })
                      }
                    >
                      <DotsThreeIcon size={20} />
                    </IconButton>
                  </Box>
                </tr>
              ))}
              {players.length === 0 && (
                <tr>
                  <Box component="td" colSpan={6} sx={{ ...td, color: color.muted }}>
                    No players reported by the server yet.
                  </Box>
                </tr>
              )}
            </tbody>
          </Box>
        </Box>
      </Box>
    );
  };

  const mapsList = state
    ? Object.entries(state.series.maps).sort(([a], [b]) => Number(a) - Number(b))
    : [];

  return (
    <Box sx={{ display: 'grid', gap: 2.25, pb: 12 }} data-testid="manage-match-page">
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <Typography sx={{ color: color.muted, fontSize: textSize.sm }}>
          <Box
            component={RouterLink}
            to={
              id || view.match.tournamentId
                ? manageTournamentPath(
                    id ? Number(id) : (view.match.tournamentId as number),
                    'matches'
                  )
                : '/manage/matches'
            }
            sx={{ color: 'inherit' }}
          >
            Matches
          </Box>{' '}
          / {matchName}
        </Typography>
        <Typography sx={{ fontSize: textSize.sm, color: connected ? color.live : color.warning }}>
          {connected
            ? `Live · updated ${view.live ? clock(view.live.updatedAt) : 'now'}`
            : 'Reconnecting…'}
        </Typography>
      </Box>
      {!connected && (
        <Alert severity="warning" role="status">
          Disconnected from the platform, retrying. What you see may be old.
        </Alert>
      )}

      <Box
        component="header"
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
          alignItems: 'flex-start',
        }}
      >
        <Box sx={{ display: 'grid', gap: 1 }}>
          <Typography
            component="h1"
            sx={{
              fontFamily: fontDisplay,
              fontWeight: 700,
              fontSize: { xs: '1.5rem', md: '1.9rem' },
            }}
          >
            {t1}{' '}
            <Box component="span" sx={{ color: color.accent }}>
              {state ? `${state.series.score.team1} – ${state.series.score.team2}` : 'vs'}
            </Box>{' '}
            {t2}
          </Typography>
          <Typography sx={{ color: color.ink2 }}>
            {view.match.round === 0
              ? 'Standalone match'
              : `Round ${view.match.round}${view.match.matchNumber ? `, match ${view.match.matchNumber}` : ''}`}
            {' · '}
            {state ? `Best of ${state.series.num_maps}` : view.match.status}
            {counts.error + counts.warn > 0 && (
              <Box
                component="span"
                sx={{ color: color.ban }}
              >{` · ${counts.error} errors, ${counts.warn} warnings`}</Box>
            )}
          </Typography>
        </Box>
        <Button component={RouterLink} to={`/match/${encodeURIComponent(slug)}`} variant="outlined">
          Players' view
        </Button>
      </Box>

      {preServer && (
        <Alert severity="info">
          {view.match.status === 'pending'
            ? 'Veto or waiting: no server yet. One is picked when the veto is done.'
            : 'Veto done: waiting for a free server.'}
        </Alert>
      )}

      {state && (
        <Section
          title={`Map ${state.series.current_map} · ${mapLabel(currentMap?.name)}`}
          aside={
            <Typography
              sx={{ fontFamily: fontMono, color: live ? color.live : color.warning }}
            >{`${state.phase.toUpperCase()}${state.round ? ` · Round ${state.round.number}` : ''}`}</Typography>
          }
          testId="manage-map-now"
        >
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
            <Typography
              sx={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: '2.6rem', lineHeight: 1 }}
            >
              {state.teams.team1.score}
            </Typography>
            <Typography sx={{ color: color.muted }}>{t1}</Typography>
            <Typography
              sx={{
                ml: 'auto',
                fontFamily: fontDisplay,
                fontWeight: 700,
                fontSize: '2.6rem',
                lineHeight: 1,
              }}
            >
              {state.teams.team2.score}
            </Typography>
            <Typography sx={{ color: color.muted }}>{t2}</Typography>
          </Box>
          {paused && (
            <Typography sx={{ color: color.warning }}>
              Paused{state.pause?.type ? ` (${state.pause.type})` : ''}
              {state.pause?.by ? `, by ${state.pause.by}` : ''}
            </Typography>
          )}
        </Section>
      )}

      {state && team('team1')}
      {state && team('team2')}
      {state && Object.keys(state.spectators ?? {}).length > 0 && (
        <Section title="Spectators">
          <Typography sx={{ color: color.ink2 }}>
            {Object.values(state.spectators ?? {})
              .map(
                (s) => `${s.name ?? 'Spectator'} (${s.connected ? 'connected' : 'not connected'})`
              )
              .join(' · ')}
          </Typography>
        </Section>
      )}

      {view.server && (
        <Section
          title="Server"
          aside={
            <Typography sx={{ color: view.server.online === false ? color.ban : color.live }}>
              {view.server.online === false
                ? 'offline'
                : view.server.fleet
                  ? 'online'
                  : 'RCON server'}
            </Typography>
          }
          testId="manage-server"
        >
          <Typography sx={{ color: color.ink2 }}>
            {view.server.name ?? view.server.id}
            {view.server.phase ? ` · Ready Up reports ${view.server.phase}` : ''}
          </Typography>
          {onReadyUp && (
            <Box sx={{ display: 'grid', gap: 1 }}>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <TextField
                  label="Run a console command"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  size="small"
                  sx={{ flex: 1, minWidth: 220 }}
                  inputProps={{ style: { fontFamily: fontMono } }}
                />
                <Button
                  variant="contained"
                  disabled={!command.trim()}
                  onClick={() =>
                    setConfirm({
                      target: 'server',
                      title: `Run “${command.trim()}” on this server?`,
                      effects: [
                        'It runs in the CS2 console of the match’s server',
                        'It is written to the admin log with your name',
                      ],
                      action: `Run ${command.trim().split(' ')[0]}`,
                      cancel: 'Don’t run it',
                      run: async () => {
                        const out = await send('exec', { command: command.trim() });
                        setCommandReply(out || `Sent: ${command.trim()} (no output)`);
                      },
                    })
                  }
                >
                  Run
                </Button>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                {['status', 'mp_warmup_end', 'mp_pause_match', 'mp_unpause_match', 'tv_status'].map(
                  (c) => (
                    <Button
                      key={c}
                      size="small"
                      variant="outlined"
                      onClick={() => setCommand(c)}
                      sx={{ fontFamily: fontMono, textTransform: 'none' }}
                    >
                      {c}
                    </Button>
                  )
                )}
              </Box>
              {commandReply && (
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    p: 1.5,
                    borderRadius: radii.md,
                    bgcolor: color.paper,
                    color: color.ink2,
                    fontFamily: fontMono,
                    fontSize: textSize.sm,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    maxHeight: 280,
                    overflowY: 'auto',
                  }}
                >
                  {commandReply}
                </Box>
              )}
            </Box>
          )}
        </Section>
      )}

      {onReadyUp && state && (
        <Target
          dot={color.accent}
          title="Match"
          who="sent to the Ready Up plugin on the server"
          state={state.phase}
        >
          {warmup && (
            <Group label="Ready-up">
              <Button
                onClick={() =>
                  setConfirm({
                    target: 'match',
                    title: `Mark both teams ready?`,
                    effects: [
                      'Everyone connected is marked ready',
                      'The map goes live when the ready rules are met',
                    ],
                    action: 'Mark both teams ready',
                    cancel: 'Wait for the players',
                    run: () => send('force_ready', {}, 'Both teams marked ready'),
                  })
                }
              >
                Force ready
              </Button>
              <Button
                onClick={() =>
                  setConfirm({
                    target: 'match',
                    title: `Start map ${state.series.current_map} now?`,
                    effects: [
                      'Warmup ends and the map goes live, ready or not',
                      'Players not on the server start without them',
                    ],
                    action: `Start map ${state.series.current_map} now`,
                    cancel: 'Keep the warmup',
                    run: () => send('start', { force: true }, 'Map started'),
                  })
                }
              >
                Start map
              </Button>
            </Group>
          )}
          {live && !paused && (
            <Group label="Pause">
              <Button
                onClick={() =>
                  setConfirm({
                    target: 'match',
                    title: 'Pause the match?',
                    effects: [
                      'It pauses at the next freeze time',
                      'Only an admin can unpause an admin pause',
                    ],
                    action: 'Pause the match',
                    cancel: 'Keep playing',
                    run: () => send('pause', { type: 'admin' }, 'Pausing at the next freeze time'),
                  })
                }
              >
                Pause
              </Button>
            </Group>
          )}
          {paused && (
            <Group label="Pause">
              <Button
                onClick={() =>
                  setConfirm({
                    target: 'match',
                    title: 'Unpause the match now?',
                    effects: ['Play goes on without waiting for both teams'],
                    action: 'Unpause now',
                    cancel: 'Stay paused',
                    run: () => send('unpause', {}, 'Unpaused'),
                  })
                }
              >
                Unpause
              </Button>
            </Group>
          )}
          {(live || paused || warmup) && (
            <Group label="Map">
              <Button
                onClick={() =>
                  setConfirm({
                    target: 'match',
                    title: `Restart map ${state.series.current_map} (${mapLabel(currentMap?.name)}) from round 1?`,
                    effects: [
                      'Every round of this map is voided; the score goes back to 0–0',
                      'Both teams ready up again',
                      'Earlier maps keep their results',
                    ],
                    action: `Restart map ${state.series.current_map} from round 1`,
                    cancel: 'Keep playing',
                    danger: true,
                    run: () => send('restart_map', {}, 'Map restarting'),
                  })
                }
              >
                Restart map
              </Button>
              {warmup && mapsList.length > 1 && (
                <Button
                  onClick={() => {
                    const next = mapsList.find(
                      ([, m]) => m.status === 'pending' && m !== currentMap
                    );
                    if (!next) return;
                    setConfirm({
                      target: 'match',
                      title: `Go to map ${next[0]} (${mapLabel(next[1].name)})?`,
                      effects: [
                        `${mapLabel(currentMap?.name)} is left for later`,
                        'The server changes map; players reconnect',
                      ],
                      action: `Change to map ${next[0]}, ${mapLabel(next[1].name)}`,
                      cancel: `Stay on ${mapLabel(currentMap?.name)}`,
                      run: () =>
                        send('change_map', { map_number: Number(next[0]) }, 'Changing map'),
                    });
                  }}
                >
                  Change map
                </Button>
              )}
              <Button
                onClick={() =>
                  setConfirm({
                    target: 'match',
                    title: 'Swap the teams’ sides?',
                    effects: [`${t1} and ${t2} switch CT and T`, 'The scores stay with the teams'],
                    action: 'Swap sides',
                    cancel: 'Keep the sides',
                    run: () => send('swap_teams', {}, 'Sides swapped'),
                  })
                }
              >
                Swap sides
              </Button>
            </Group>
          )}
          <Group label="Players">
            <Button
              onClick={() =>
                setConfirm({
                  target: 'match',
                  title: 'Message everyone on the server?',
                  body: message || 'Write the message below first.',
                  effects: ['It shows in the in-game chat as an admin message'],
                  action: 'Send to everyone',
                  cancel: 'Don’t send',
                  run: () => send('say', { text: message, as_admin: true }, 'Sent'),
                })
              }
              disabled={!message.trim()}
            >
              Message all
            </Button>
          </Group>
          <Box sx={{ flexBasis: '100%' }}>
            <TextField
              label="Message for everyone on the server"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              size="small"
              fullWidth
              inputProps={{ maxLength: 190 }}
            />
          </Box>
          {(live || paused || warmup) && (
            <Group label="End">
              {(['team1', 'team2'] as const).map((w) => (
                <Button
                  key={w}
                  color="error"
                  onClick={() =>
                    setConfirm({
                      target: 'match',
                      title: `End the series with ${w === 'team1' ? t1 : t2} as winner?`,
                      body: 'The match is finished now, whatever is being played. This moves the bracket.',
                      effects: [
                        `${w === 'team1' ? t1 : t2} wins the series`,
                        'Players are disconnected and the server is freed',
                      ],
                      action: `End series, ${w === 'team1' ? t1 : t2} wins`,
                      cancel: 'Keep the match going',
                      danger: true,
                      typeToConfirm: matchName,
                      run: () => send('end', { winner: w, reason: 'admin' }, 'Series ended'),
                    })
                  }
                >
                  {w === 'team1' ? t1 : t2} wins
                </Button>
              ))}
            </Group>
          )}
        </Target>
      )}

      {view.server && (
        <Target dot={color.info} title="Server" who="where the match runs">
          <Group label="Instance">
            {onReadyUp && (
              <Button
                onClick={() =>
                  setConfirm({
                    target: 'server',
                    title: `Restart ${view.server?.name ?? 'this server'}?`,
                    effects: [
                      'csm restarts the CS2 server (about a minute)',
                      'Everyone is disconnected and joins again',
                      'Ready Up reloads the match and restores the last round',
                    ],
                    action: 'Restart the server',
                    cancel: 'Leave it running',
                    danger: true,
                    run: () =>
                      post(
                        `/api/game/cs2/matches/${encodeURIComponent(slug)}/manage/restart-server`,
                        {},
                        'Restarting the server'
                      ),
                  })
                }
              >
                Restart server
              </Button>
            )}
            <Button
              onClick={() =>
                setConfirm({
                  target: 'server',
                  title: 'Move this match to another free server?',
                  effects: [
                    'The match is loaded on the next free server',
                    'Players are told the new address; the last round is restored there',
                  ],
                  action: 'Move to another server',
                  cancel: 'Stay on this server',
                  run: () =>
                    post(
                      `/api/matches/${encodeURIComponent(slug)}/reallocate`,
                      {},
                      'Moving to another server'
                    ),
                })
              }
            >
              Move to another server
            </Button>
            <Button
              onClick={() =>
                setConfirm({
                  target: 'match',
                  title: 'Restart the match: where does it pick up?',
                  body: 'Pick where play goes on from. Everyone keeps their place on the server unless the match is reloaded.',
                  effects: [
                    'From the last round: the match config is sent again, the map reloads and the last round backup is restored',
                    'From an earlier round: rounds from it on are voided; money and equipment as they were then',
                    'From round 1: every round of this map is voided and both teams ready up again',
                  ],
                  choiceLabel: 'Pick up from',
                  choices: [
                    {
                      value: 'last',
                      label: `The last round${rounds.length ? ` (round ${rounds[rounds.length - 1].round_number})` : ''}: reload the match`,
                    },
                    ...[...rounds]
                      .reverse()
                      .slice(1, 31)
                      .map((r) => ({
                        value: `round:${r.round_number}`,
                        label: `The start of round ${r.round_number} (${r.team1_score - (r.winner_team === 1 ? 1 : 0)}–${r.team2_score - (r.winner_team === 2 ? 1 : 0)})`,
                      })),
                    ...(state
                      ? [
                          {
                            value: 'scratch',
                            label: `Round 1: start map ${state.series.current_map} again`,
                          },
                        ]
                      : []),
                  ],
                  action: 'Restart the match',
                  cancel: 'Leave it running',
                  danger: true,
                  run: (choice) => {
                    if (choice === 'scratch')
                      return send('restart_map', {}, 'Map restarting from round 1');
                    if (choice?.startsWith('round:') && state)
                      return send(
                        'restore_round',
                        { map_number: state.series.current_map, round: Number(choice.slice(6)) },
                        'Restoring'
                      );
                    return post(
                      `/api/matches/${encodeURIComponent(slug)}/restart`,
                      {},
                      'Reloading the match'
                    );
                  },
                })
              }
            >
              Restart the match
            </Button>
          </Group>
        </Target>
      )}

      <Target dot={color.live} title="Tournament" who="changes the platform: veto, result, chat">
        {['pending', 'ready'].includes(view.match.status) && !view.server && (
          <Group label="Veto">
            <Button
              onClick={() =>
                setConfirm({
                  target: 'tournament',
                  title: 'Restart the veto?',
                  effects: [
                    'Every ban, pick and side so far is cleared',
                    'Both teams see it in the match chat',
                  ],
                  action: 'Restart the veto',
                  cancel: 'Keep the veto',
                  run: () =>
                    post(`/api/veto/${encodeURIComponent(slug)}/reset`, {}, 'The veto starts over'),
                })
              }
            >
              Restart veto
            </Button>
          </Group>
        )}
        {view.match.status === 'needs_decision' && (
          <Group label="Result">
            {(['team1', 'team2'] as const).map((w) => (
              <Button
                key={w}
                onClick={() =>
                  setConfirm({
                    target: 'tournament',
                    title: `Set ${w === 'team1' ? t1 : t2} as the winner?`,
                    effects: ['The series is recorded for them and the bracket moves on'],
                    action: `${w === 'team1' ? t1 : t2} wins`,
                    cancel: 'Decide later',
                    typeToConfirm: matchName,
                    run: () =>
                      post(
                        `/api/matches/${encodeURIComponent(slug)}/winner`,
                        { winner: w },
                        'Winner set'
                      ),
                  })
                }
              >
                {w === 'team1' ? t1 : t2} wins
              </Button>
            ))}
          </Group>
        )}
        <Group label="Chat">
          <Button onClick={() => openChat(`match:${slug}`, matchName)}>Open match chat</Button>
        </Group>
        {view.match.status !== 'completed' && view.match.status !== 'cancelled' && (
          <Group label="Cancel">
            <Button
              color="error"
              onClick={() =>
                setConfirm({
                  target: 'tournament',
                  title: 'Cancel this match?',
                  body: 'For a match that cannot be played. Nobody wins it.',
                  effects: ['The match is marked cancelled', 'The server is freed'],
                  action: 'Cancel the match',
                  cancel: 'Keep the match',
                  danger: true,
                  typeToConfirm: matchName,
                  run: () =>
                    post(
                      `/api/matches/${encodeURIComponent(slug)}/force-cancel`,
                      {},
                      'Match cancelled'
                    ),
                })
              }
            >
              Cancel match
            </Button>
          </Group>
        )}
      </Target>

      {['pending', 'ready', 'loaded'].includes(view.match.status) && (
        <Section title="Hold this match" testId="manage-hold">
          <MatchHoldPanel
            matchSlug={slug}
            matchStatus={view.match.status}
            onSuccess={showSuccess}
            onError={showError}
          />
        </Section>
      )}

      {onReadyUp && (
        <Section title="Roster" testId="manage-roster">
          <FleetRosterEditor matchSlug={slug} onSuccess={showSuccess} />
        </Section>
      )}

      {ModulePanel && view.server && (
        <Section title="Failover and round backups">
          <ModulePanel
            matchSlug={slug}
            matchStatus={view.match.status}
            onSuccess={showSuccess}
            onError={showError}
          />
        </Section>
      )}

      {mapsList.length > 0 && (
        <Section title="Maps" testId="manage-maps">
          <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <Box component="th" scope="col" sx={th}>
                    Map
                  </Box>
                  <Box component="th" scope="col" sx={th}>
                    Name
                  </Box>
                  <Box component="th" scope="col" sx={th}>
                    Score
                  </Box>
                  <Box component="th" scope="col" sx={th}>
                    State
                  </Box>
                  <Box component="th" scope="col" sx={th}>
                    Demo
                  </Box>
                </tr>
              </thead>
              <tbody>
                {mapsList.map(([n, m]) => (
                  <tr key={n}>
                    <Box component="td" sx={{ ...td, color: color.muted }}>
                      Map {n}
                    </Box>
                    <Box component="td" sx={{ ...td, fontWeight: 600 }}>
                      {mapLabel(m.name)}
                    </Box>
                    <Box component="td" sx={{ ...td, fontFamily: fontMono }}>
                      {m.score ? `${m.score.team1} – ${m.score.team2}` : '—'}
                    </Box>
                    <Box
                      component="td"
                      sx={{ ...td, color: m.status === 'live' ? color.live : color.ink2 }}
                    >
                      {m.status === 'done'
                        ? `${m.winner === 'team1' ? t1 : m.winner === 'team2' ? t2 : 'Nobody'} won`
                        : m.status === 'live'
                          ? 'Live'
                          : 'Not played yet'}
                    </Box>
                    <Box component="td" sx={{ ...td, color: color.muted }}>
                      {m.demo?.state ?? '—'}
                    </Box>
                  </tr>
                ))}
              </tbody>
            </Box>
          </Box>
        </Section>
      )}

      {rounds.length > 0 && state && (
        <Section
          title="Rounds on this map"
          aside={
            <Typography sx={{ color: color.muted, fontSize: textSize.sm }}>
              Pick a round to see it, then restore it
            </Typography>
          }
          testId="manage-rounds"
        >
          <Box sx={{ display: 'grid', gap: 0.75 }}>
            {[...rounds].reverse().map((r) => (
              <Button
                key={r.round_number}
                onClick={() =>
                  setSelectedRound(r.round_number === selectedRound ? null : r.round_number)
                }
                variant={r.round_number === selectedRound ? 'contained' : 'outlined'}
                sx={{ justifyContent: 'flex-start', gap: 2, textTransform: 'none' }}
                aria-pressed={r.round_number === selectedRound}
              >
                <Box component="span" sx={{ width: 90, textAlign: 'left' }}>
                  Round {r.round_number}
                </Box>
                <Box component="span" sx={{ flex: 1, textAlign: 'left' }}>
                  {r.winner_team === 1 ? t1 : r.winner_team === 2 ? t2 : 'Nobody'} won
                  {ROUND_REASON[r.reason] ? ` · ${ROUND_REASON[r.reason]}` : ''}
                </Box>
                <Box component="span" sx={{ fontFamily: fontMono }}>
                  {r.team1_score} – {r.team2_score}
                </Box>
              </Button>
            ))}
          </Box>
          {shownRound && (
            <Box
              sx={{
                border: `1px solid ${color.accent}`,
                borderRadius: radii.lg,
                p: 2,
                display: 'grid',
                gap: 1.5,
              }}
              data-testid="manage-round-detail"
            >
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 2,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <Typography component="h3" sx={{ fontFamily: fontDisplay, fontWeight: 600 }}>
                  Round {shownRound.round_number}
                </Typography>
                {onReadyUp && (
                  <Button
                    variant="contained"
                    onClick={() =>
                      setConfirm({
                        target: 'match',
                        title: `Restore to the start of round ${shownRound.round_number}?`,
                        effects: [
                          `Rounds from ${shownRound.round_number} on are voided`,
                          'Everyone gets the money and equipment they had then',
                          'The match pauses so the teams can unpause together',
                        ],
                        action: `Restore to the start of round ${shownRound.round_number}`,
                        cancel: 'Keep playing',
                        danger: true,
                        run: () =>
                          send(
                            'restore_round',
                            {
                              map_number: state.series.current_map,
                              round: shownRound.round_number,
                            },
                            'Restoring'
                          ),
                      })
                    }
                  >
                    Restore to the start of round {shownRound.round_number}
                  </Button>
                )}
              </Box>
              {([1, 2] as const).map((tk) => (
                <Box key={tk} sx={{ overflowX: 'auto' }}>
                  <Typography sx={{ fontWeight: 600, mb: 0.5 }}>{tk === 1 ? t1 : t2}</Typography>
                  <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <Box component="th" scope="col" sx={th}>
                          Player
                        </Box>
                        <Box component="th" scope="col" sx={th}>
                          Money at start
                        </Box>
                        <Box component="th" scope="col" sx={th}>
                          Bought
                        </Box>
                        <Box component="th" scope="col" sx={th}>
                          Armour
                        </Box>
                        <Box component="th" scope="col" sx={th}>
                          Kills
                        </Box>
                        <Box component="th" scope="col" sx={th}>
                          Damage
                        </Box>
                        <Box component="th" scope="col" sx={th}>
                          Survived
                        </Box>
                      </tr>
                    </thead>
                    <tbody>
                      {shownRound.players
                        .filter((p) => p.team === tk)
                        .map((p) => (
                          <tr key={p.id}>
                            <Box component="td" sx={td}>
                              {playerName(p.id)}
                            </Box>
                            <Box component="td" sx={{ ...td, fontFamily: fontMono }}>
                              {money(p.money_start)}
                            </Box>
                            <Box component="td" sx={{ ...td, color: color.ink2 }}>
                              {(p.loadout ?? []).map(weaponLabel).join(', ') || '—'}
                            </Box>
                            <Box component="td" sx={{ ...td, color: color.ink2 }}>
                              {armourLabel(p)}
                            </Box>
                            <Box component="td" sx={td}>
                              {p.kills}
                            </Box>
                            <Box component="td" sx={td}>
                              {p.damage}
                            </Box>
                            <Box
                              component="td"
                              sx={{ ...td, color: p.died ? color.muted : color.live }}
                            >
                              {p.died ? 'No' : 'Yes'}
                            </Box>
                          </tr>
                        ))}
                    </tbody>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Section>
      )}

      <Section
        title="Logs"
        testId="manage-logs"
        aside={
          <ToggleButtonGroup
            size="small"
            exclusive
            value={source}
            onChange={(_, v) => v && setSource(v)}
            aria-label="Source"
          >
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="server">Server</ToggleButton>
            <ToggleButton value="platform">Platform</ToggleButton>
            <ToggleButton value="admin">Admins</ToggleButton>
          </ToggleButtonGroup>
        }
      >
        <ToggleButtonGroup
          size="small"
          value={levels}
          onChange={(_, v: string[]) => setLevels(v)}
          aria-label="Level"
        >
          <ToggleButton value="error">Errors {counts.error}</ToggleButton>
          <ToggleButton value="warn">Warnings {counts.warn}</ToggleButton>
          <ToggleButton value="info">Info</ToggleButton>
          <ToggleButton value="admin">Admin actions</ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ overflowX: 'auto' }}>
          <Box
            component="table"
            sx={{ width: '100%', borderCollapse: 'collapse', fontFamily: fontMono }}
          >
            <thead>
              <tr>
                <Box component="th" scope="col" sx={th}>
                  Time
                </Box>
                <Box component="th" scope="col" sx={th}>
                  Level
                </Box>
                <Box component="th" scope="col" sx={th}>
                  From
                </Box>
                <Box component="th" scope="col" sx={th}>
                  Message
                </Box>
              </tr>
            </thead>
            <tbody>
              {log.slice(0, 200).map((l, i) => (
                <tr key={`${l.at}-${i}`}>
                  <Box
                    component="td"
                    sx={{ ...td, fontSize: textSize.sm, color: color.muted, whiteSpace: 'nowrap' }}
                  >
                    {clock(l.at)}
                  </Box>
                  <Box
                    component="td"
                    sx={{ ...td, fontSize: textSize.sm, color: LEVEL_COLOR[l.level] }}
                  >
                    {l.level.toUpperCase()}
                  </Box>
                  <Box component="td" sx={{ ...td, fontSize: textSize.sm, color: color.muted }}>
                    {l.by ?? l.source}
                  </Box>
                  <Box
                    component="td"
                    sx={{ ...td, fontSize: textSize.sm, overflowWrap: 'anywhere' }}
                  >
                    {l.text}
                  </Box>
                </tr>
              ))}
              {log.length === 0 && (
                <tr>
                  <Box component="td" colSpan={4} sx={{ ...td, color: color.muted }}>
                    Nothing logged with these filters.
                  </Box>
                </tr>
              )}
            </tbody>
          </Box>
        </Box>
      </Section>

      <Menu open={Boolean(menu)} anchorEl={menu?.anchor} onClose={() => setMenu(null)}>
        {warmup && (
          <MenuItem
            onClick={() => {
              const m = menu;
              setMenu(null);
              if (!m) return;
              setConfirm({
                target: 'match',
                title: `Mark ${m.name} ready?`,
                effects: [
                  `${m.name} counts as ready`,
                  'The map goes live when the ready rules are met',
                ],
                action: `Mark ${m.name} ready`,
                cancel: 'Wait for them',
                run: () => send('force_ready', { steamid64: m.id }, `${m.name} marked ready`),
              });
            }}
          >
            Mark ready
          </MenuItem>
        )}
        <MenuItem
          sx={{ color: color.ban }}
          onClick={() => {
            const m = menu;
            setMenu(null);
            if (!m) return;
            setConfirm({
              target: 'match',
              title: `Kick ${m.name} from the server?`,
              effects: [
                `${m.name} is disconnected`,
                'They can join again unless removed from the roster',
              ],
              action: `Kick ${m.name}`,
              cancel: `Keep ${m.name}`,
              danger: true,
              run: () =>
                send(
                  'kick',
                  { steamid64: m.id, message: 'Kicked by a tournament admin' },
                  `${m.name} kicked`
                ),
            });
          }}
        >
          Kick from the server
        </MenuItem>
      </Menu>
      <ConfirmAction spec={confirm} onClose={() => setConfirm(null)} />
    </Box>
  );
}
