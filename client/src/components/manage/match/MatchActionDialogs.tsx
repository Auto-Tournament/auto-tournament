import { useEffect, useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  MenuItem,
  Radio,
  TextField,
  Typography,
} from '@mui/material';
import { PlayerPicker } from '../../common/PlayerPicker';
import { api } from '../../../utils/api';
import { radii, textSize, tokens } from '../../../theme/tokens';
import type { ActionTarget } from './ConfirmAction';
import type { Untrusted } from '../../../utils/untrusted';

const { color } = tokens;

const TARGET_LABEL: Record<ActionTarget, string> = {
  match: 'Match · Ready Up',
  server: 'Server · csm + platform',
  tournament: 'Tournament · platform',
};

const ACCENT: Record<ActionTarget, string> = {
  match: color.accent,
  server: color.info,
  tournament: color.live,
};

/**
 * The frame every action dialog on the admin match page shares (the
 * ActionDialogs board): the target as a small tag, the question as the title,
 * what it needs in between, and two buttons that say what each one does.
 */
function ActionDialog({
  target,
  title,
  children,
  cancel,
  action,
  disabled,
  onClose,
  onRun,
  testId,
}: {
  target: ActionTarget;
  title: string;
  children: ReactNode;
  cancel: string;
  action: string;
  disabled?: boolean;
  onClose: () => void;
  onRun: () => Promise<Untrusted>;
  testId: string;
}) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await onRun();
      onClose();
    } catch {
      // The page already showed what went wrong; the dialog stays open.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid={testId}>
      <DialogTitle sx={{ pb: 1 }}>
        <Typography
          component="span"
          sx={{
            display: 'block',
            fontSize: textSize.xs,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: ACCENT[target],
            mb: 1,
          }}
        >
          {TARGET_LABEL[target]}
        </Typography>
        {title}
      </DialogTitle>
      <DialogContent
        // Room for the first field's floating label under the title.
        sx={{ display: 'grid', gap: 2, '&&': { pt: 1 } }}
      >
        {children}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1, flexWrap: 'wrap' }}>
        <Button onClick={onClose} variant="outlined">
          {cancel}
        </Button>
        <Button
          onClick={() => void run()}
          variant="contained"
          disabled={busy || disabled}
          data-testid={`${testId}-run`}
          sx={{
            bgcolor: ACCENT[target],
            color: color.paper,
            '&:hover': { bgcolor: ACCENT[target], filter: 'brightness(1.1)' },
          }}
        >
          {action}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Effects({ items }: { items: string[] }) {
  return (
    <Box
      component="ul"
      sx={{ m: 0, py: 1.5, pr: 2, pl: 4, borderRadius: radii.md, bgcolor: color.paper3 }}
    >
      {items.map((e) => (
        <li key={e}>
          <Typography sx={{ fontSize: textSize.sm }}>{e}</Typography>
        </li>
      ))}
    </Box>
  );
}

const cell = { py: 1.1, px: 1, borderBottom: `1px solid ${color.rule}`, fontSize: textSize.sm };

// ---- Move to another server ----

/** GET /api/game/cs2/matches/:slug/manage/servers. */
interface ServerChoice {
  id: string;
  name: string;
  state: 'free' | 'busy' | 'offline';
  busyWith: string | null;
  lastSeen: number | null;
  readyUp: string | null;
  cs2Build: number | null;
}

function ago(unixSeconds: number): string {
  const minutes = Math.max(1, Math.round((Date.now() / 1000 - unixSeconds) / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

/**
 * Pick the server the match moves to. Free servers can be picked; busy and
 * offline ones are listed so the admin sees why there is no other choice.
 */
export function MoveServerDialog({
  slug,
  mode = 'move',
  serverName,
  round,
  onClose,
  post,
}: {
  slug: string;
  /** move: a match on a server goes to another; allocate: a waiting match gets its first. */
  mode?: 'move' | 'allocate';
  serverName: string;
  /** The round in progress, restored on the new server. */
  round: number | null;
  onClose: () => void;
  post: (url: string, body: Record<string, Untrusted>, ok: string) => Promise<void>;
}) {
  const [servers, setServers] = useState<ServerChoice[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api
      .get<{ servers?: ServerChoice[] }>(
        `/api/game/cs2/matches/${encodeURIComponent(slug)}/manage/servers`
      )
      .then((r) => {
        if (!live) return;
        const list = r.servers ?? [];
        setServers(list);
        setPicked(list.find((s) => s.state === 'free')?.id ?? null);
      })
      .catch(() => live && setServers([]));
    return () => {
      live = false;
    };
  }, [slug]);
  const target = servers?.find((s) => s.id === picked) ?? null;
  return (
    <ActionDialog
      target="server"
      title={mode === 'move' ? 'Move this match to another server?' : 'Put this match on a server?'}
      cancel={mode === 'move' ? `Stay on ${serverName}` : 'Wait for a free one'}
      action={target ? `${mode === 'move' ? 'Move to' : 'Load on'} ${target.name}` : 'Move'}
      disabled={!target}
      onClose={onClose}
      testId="manage-move-server"
      onRun={() =>
        mode === 'move'
          ? post(
              `/api/game/cs2/matches/${encodeURIComponent(slug)}/failover/move`,
              { targetServerId: picked, ...(round ? { round } : {}) },
              `Moving to ${target?.name ?? 'the new server'}`
            )
          : post(
              `/api/game/cs2/matches/${encodeURIComponent(slug)}/manage/allocate`,
              { serverId: picked },
              `Loading on ${target?.name ?? 'the server'}`
            )
      }
    >
      <Typography sx={{ color: color.ink2 }}>
        {mode === 'move'
          ? 'Pick a free server. Players are told the new address in chat and in the match room; the round in progress is restored there.'
          : 'Pick a free server. The match loads there now instead of waiting its turn; players see the address in the match room.'}
      </Typography>
      {servers === null ? (
        <CircularProgress size={22} />
      ) : servers.length === 0 ? (
        <Typography sx={{ color: color.muted }}>No other Ready Up server is set up.</Typography>
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Box component="th" scope="col" sx={{ ...cell, width: 40 }}>
                  <Box component="span" sx={{ position: 'absolute', left: -9999 }}>
                    Pick
                  </Box>
                </Box>
                {['Server', 'Health', 'Versions'].map((h) => (
                  <Box
                    key={h}
                    component="th"
                    scope="col"
                    sx={{ ...cell, textAlign: 'left', fontWeight: 500, color: color.muted }}
                  >
                    {h}
                  </Box>
                ))}
              </tr>
            </thead>
            <tbody>
              {servers.map((s) => {
                const free = s.state === 'free';
                return (
                  <Box
                    component="tr"
                    key={s.id}
                    onClick={() => free && setPicked(s.id)}
                    sx={{
                      cursor: free ? 'pointer' : 'default',
                      bgcolor: picked === s.id ? 'rgba(127, 212, 155, 0.12)' : 'transparent',
                    }}
                  >
                    <Box component="td" sx={cell}>
                      <Radio
                        size="small"
                        checked={picked === s.id}
                        disabled={!free}
                        onChange={() => setPicked(s.id)}
                        inputProps={{ 'aria-label': s.name }}
                      />
                    </Box>
                    <Box component="td" sx={{ ...cell, fontWeight: 600 }}>
                      {s.name}
                    </Box>
                    <Box
                      component="td"
                      sx={{
                        ...cell,
                        color: free ? color.live : s.state === 'offline' ? color.ban : color.muted,
                      }}
                    >
                      {free
                        ? 'Free · healthy'
                        : s.state === 'busy'
                          ? `Busy${s.busyWith ? ` (${s.busyWith})` : ''}`
                          : `Offline${s.lastSeen ? ` ${ago(s.lastSeen)}` : ''}`}
                    </Box>
                    <Box component="td" sx={{ ...cell, color: color.ink2 }}>
                      {free
                        ? [
                            s.readyUp ? `Ready Up ${s.readyUp}` : null,
                            s.cs2Build ? `CS2 build ${s.cs2Build}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || '—'
                        : '—'}
                    </Box>
                  </Box>
                );
              })}
            </tbody>
          </Box>
        </Box>
      )}
    </ActionDialog>
  );
}

// ---- Change map ----

export interface SeriesMap {
  number: number;
  name: string;
  status: 'pending' | 'live' | 'done';
  score?: { team1: number; team2: number };
}

/** Go to another map of the series; the current one keeps its rounds. */
export function ChangeMapDialog({
  current,
  maps,
  onClose,
  send,
}: {
  current: SeriesMap | undefined;
  maps: SeriesMap[];
  onClose: () => void;
  send: (name: string, args: Record<string, Untrusted>, ok?: string) => Promise<Untrusted>;
}) {
  const others = maps.filter((m) => m.number !== current?.number);
  const [picked, setPicked] = useState<number | null>(
    others.find((m) => m.status === 'pending')?.number ?? others[0]?.number ?? null
  );
  const target = others.find((m) => m.number === picked);
  const currentLabel = current ? mapName(current.name) : 'this map';
  return (
    <ActionDialog
      target="match"
      title="Go to another map of the series?"
      cancel={`Stay on ${currentLabel}`}
      action={target ? `Change to map ${target.number}, ${mapName(target.name)}` : 'Change map'}
      disabled={!target}
      onClose={onClose}
      testId="manage-change-map"
      onRun={() =>
        send('change_map', { map_number: target?.number }, `Changing to ${mapName(target?.name)}`)
      }
    >
      {current && (
        <Typography sx={{ color: color.ink2 }}>
          {`${currentLabel} (map ${current.number}) is ${current.status === 'live' ? 'live' : 'loaded'}${
            current.score ? ` at ${current.score.team1}–${current.score.team2}` : ''
          }. Its rounds are kept and it can be finished later.`}
        </Typography>
      )}
      {others.map((m) => (
        <Box
          key={m.number}
          component="label"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            p: '10px 14px',
            borderRadius: radii.md,
            border: `1px solid ${picked === m.number ? color.accent : color.rule}`,
            bgcolor: color.paper3,
            cursor: 'pointer',
          }}
        >
          <Radio size="small" checked={picked === m.number} onChange={() => setPicked(m.number)} />
          <Typography sx={{ fontWeight: 600 }}>
            Map {m.number} · {mapName(m.name)}
          </Typography>
          <Typography sx={{ color: color.muted, fontSize: textSize.sm }}>
            {m.status === 'done'
              ? `Finished${m.score ? ` ${m.score.team1}–${m.score.team2}` : ''} (replaying it voids the result)`
              : 'Not played yet'}
          </Typography>
        </Box>
      ))}
    </ActionDialog>
  );
}

/** "de_overpass" -> "Overpass". */
export function mapName(name: string | undefined): string {
  if (!name) return 'map';
  const bare = name.replace(/^(de|cs|ar|dz)_/, '');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

// ---- Roster: move, spectate, substitute ----

/** GET /api/fleet/matches/:slug/roster, the parts used here. */
interface RosterInfo {
  fleet: boolean;
  configRev: number;
  roster: {
    team1: { name: string; players: Array<{ steamid64: string; name: string; role?: string }> };
    team2: { name: string; players: Array<{ steamid64: string; name: string; role?: string }> };
  } | null;
}

export type RosterOp =
  | {
      op: 'add_player';
      team: 'team1' | 'team2' | 'spectator';
      steamid64: string;
      name: string;
      role?: string;
    }
  | { op: 'remove_player'; steamid64: string };

/** Send roster ops to the match's server against the rev it last acked (FLEET.md §7.3). */
export async function sendRoster(slug: string, ops: (rev: RosterInfo) => RosterOp[]) {
  const info = await api.get<RosterInfo>(`/api/fleet/matches/${encodeURIComponent(slug)}/roster`);
  if (!info.fleet || !info.roster) throw new Error('The match is not on a Ready Up server');
  return api.post(`/api/fleet/matches/${encodeURIComponent(slug)}/update`, {
    ops: ops(info),
    baseConfigRev: info.configRev,
  });
}

/** Swap a player for a substitute (the team's subs, or anyone by SteamID64). */
export function SwapSubDialog({
  slug,
  player,
  team,
  teamName,
  side,
  onClose,
  onDone,
  onError,
}: {
  slug: string;
  player: { id: string; name: string };
  team: 'team1' | 'team2';
  teamName: string;
  side: string | null;
  onClose: () => void;
  onDone: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [subs, setSubs] = useState<Array<{ steamid64: string; name: string }> | null>(null);
  const [picked, setPicked] = useState<string>('');
  const [other, setOther] = useState({ steamid64: '', name: '' });
  useEffect(() => {
    let live = true;
    api
      .get<RosterInfo>(`/api/fleet/matches/${encodeURIComponent(slug)}/roster`)
      .then((info) => {
        if (!live) return;
        const list = (info.roster?.[team].players ?? []).filter(
          (p) => p.role === 'sub' && p.steamid64 !== player.id
        );
        setSubs(list);
        setPicked(list[0]?.steamid64 ?? 'other');
      })
      .catch(() => {
        if (!live) return;
        setSubs([]);
        setPicked('other');
      });
    return () => {
      live = false;
    };
  }, [slug, team, player.id]);
  const incoming =
    picked === 'other'
      ? other.steamid64
        ? other
        : null
      : (subs?.find((s) => s.steamid64 === picked) ?? null);
  return (
    <ActionDialog
      target="match"
      title={`Swap ${player.name} for a substitute?`}
      cancel={`Keep ${player.name}`}
      action={incoming ? `Swap ${player.name} for ${incoming.name}` : 'Swap'}
      disabled={!incoming}
      onClose={onClose}
      testId="manage-swap-sub"
      onRun={async () => {
        if (!incoming) return;
        try {
          await sendRoster(slug, () => [
            { op: 'remove_player', steamid64: player.id },
            { op: 'add_player', team: 'spectator', steamid64: player.id, name: player.name },
            ...(picked === 'other'
              ? []
              : [{ op: 'remove_player' as const, steamid64: incoming.steamid64 }]),
            {
              op: 'add_player',
              team,
              steamid64: incoming.steamid64,
              name: incoming.name,
              role: 'player',
            },
          ]);
          onDone(`${incoming.name} is in for ${player.name}`);
        } catch (error) {
          onError((error as Error).message || 'The server refused it');
          throw error;
        }
      }}
    >
      {subs === null ? (
        <CircularProgress size={22} />
      ) : (
        <TextField
          select
          label="Substitute"
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          inputProps={{ 'data-testid': 'manage-swap-sub-pick' }}
        >
          {subs.map((s) => (
            <MenuItem key={s.steamid64} value={s.steamid64}>
              {`${s.name} (${teamName} substitute)`}
            </MenuItem>
          ))}
          <MenuItem value="other">Pick any player…</MenuItem>
        </TextField>
      )}
      {picked === 'other' && (
        <PlayerPicker
          label="Player"
          value={other.steamid64 ? other : null}
          onChange={(p) => setOther(p ?? { steamid64: '', name: '' })}
          exclude={[player.id]}
          testId="manage-swap-sub-player"
          autoFocus
        />
      )}
      <Effects
        items={[
          `${player.name} is moved to spectator and can’t join the team for this match`,
          `${incoming?.name ?? 'The substitute'} can join${side ? ` on the ${side} side` : ''} right away`,
          `The match roster and the stats from now on use ${incoming?.name ?? 'the substitute'}`,
        ]}
      />
    </ActionDialog>
  );
}

// ---- Act for a team in the veto ----

interface VetoView {
  status: 'pending' | 'in_progress' | 'completed';
  currentStep: number;
  totalSteps: number;
  currentTurn: 'team1' | 'team2';
  currentAction: string;
  availableMaps: string[];
  allMaps?: string[];
  team1Name?: string;
  team2Name?: string;
}

/** Ban or pick a map for the team whose turn it is; both teams see that an admin did it. */
export function ActForTeamDialog({
  slug,
  onClose,
  onDone,
  onError,
}: {
  slug: string;
  onClose: () => void;
  onDone: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [veto, setVeto] = useState<VetoView | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api
      .get<{ veto?: VetoView }>(`/api/veto/${encodeURIComponent(slug)}`)
      .then((r) => live && (r.veto ? setVeto(r.veto) : setFailed(true)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [slug]);
  const teamName = veto
    ? (veto.currentTurn === 'team1' ? veto.team1Name : veto.team2Name) || 'the team'
    : 'the team';
  const verb = veto?.currentAction === 'pick' ? 'Pick' : 'Ban';
  const sidePick = veto?.currentAction === 'side_pick';
  const open = veto && veto.status !== 'completed' && !sidePick;
  return (
    <ActionDialog
      target="tournament"
      title={open ? `${verb} a map for ${teamName}?` : 'Act for a team in the veto'}
      cancel="Let them choose"
      action={picked ? `${verb} ${mapName(picked)} for ${teamName}` : verb}
      disabled={!open || !picked}
      onClose={onClose}
      testId="manage-act-for"
      onRun={async () => {
        const res = await fetch(`/api/veto/${encodeURIComponent(slug)}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mapName: picked, actAs: veto?.currentTurn }),
        });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
        if (!data.success) {
          onError(data.error || 'The veto refused it');
          throw new Error(data.error);
        }
        onDone(`${mapName(picked ?? '')} ${verb === 'Pick' ? 'picked' : 'banned'} for ${teamName}`);
      }}
    >
      {failed ? (
        <Typography sx={{ color: color.ban }}>The veto could not be loaded.</Typography>
      ) : !veto ? (
        <CircularProgress size={22} />
      ) : !open ? (
        <Typography sx={{ color: color.ink2 }}>
          {sidePick
            ? `${teamName} picks a side next. Do it from the players' view of the match.`
            : 'The veto is done.'}
        </Typography>
      ) : (
        <>
          <Typography sx={{ color: color.ink2 }}>
            {`It is ${teamName}’s turn to ${verb.toLowerCase()} (step ${veto.currentStep} of ${veto.totalSteps}). Both teams see in chat that an admin made this step.`}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
              gap: 1,
            }}
          >
            {(veto.allMaps ?? veto.availableMaps).map((m) => {
              const available = veto.availableMaps.includes(m);
              const on = picked === m;
              return (
                <Button
                  key={m}
                  disabled={!available}
                  onClick={() => setPicked(m)}
                  aria-pressed={on}
                  sx={{
                    height: 56,
                    borderRadius: radii.md,
                    border: `1px solid ${on ? color.live : color.rule}`,
                    bgcolor: on ? 'rgba(127, 212, 155, 0.12)' : color.paper3,
                    color: on ? color.live : color.ink,
                    fontWeight: 600,
                  }}
                >
                  {mapName(m)}
                </Button>
              );
            })}
          </Box>
        </>
      )}
    </ActionDialog>
  );
}

// ---- Correct a map's result ----

export function CorrectMapDialog({
  slug,
  map,
  t1,
  t2,
  seriesNow,
  onClose,
  post,
}: {
  slug: string;
  map: SeriesMap;
  t1: string;
  t2: string;
  /** Maps won so far: [team1, team2]. */
  seriesNow: [number, number];
  onClose: () => void;
  post: (url: string, body: Record<string, Untrusted>, ok: string) => Promise<void>;
}) {
  const [s1, setS1] = useState(String(map.score?.team1 ?? 0));
  const [s2, setS2] = useState(String(map.score?.team2 ?? 0));
  const wasWinner =
    map.score && map.score.team1 !== map.score.team2
      ? map.score.team1 > map.score.team2
        ? 'team1'
        : 'team2'
      : 'team1';
  const [winner, setWinner] = useState<'team1' | 'team2'>(wasWinner);
  const [reason, setReason] = useState('');
  const n1 = Number(s1);
  const n2 = Number(s2);
  const valid =
    Number.isInteger(n1) && Number.isInteger(n2) && n1 >= 0 && n2 >= 0 && n1 <= 99 && n2 <= 99;
  const after: [number, number] = [
    seriesNow[0] - (wasWinner === 'team1' ? 1 : 0) + (winner === 'team1' ? 1 : 0),
    seriesNow[1] - (wasWinner === 'team2' ? 1 : 0) + (winner === 'team2' ? 1 : 0),
  ];
  const same = after[0] === seriesNow[0] && after[1] === seriesNow[1];
  return (
    <ActionDialog
      target="tournament"
      title={`Correct map ${map.number} (${mapName(map.name)})?`}
      cancel="Keep the result"
      action={`Save map ${map.number} as ${s1 || 0}–${s2 || 0} ${winner === 'team1' ? t1 : t2}`}
      disabled={!valid || !reason.trim()}
      onClose={onClose}
      testId="manage-correct-map"
      onRun={() =>
        post(
          `/api/matches/${encodeURIComponent(slug)}/maps/${map.number}/result`,
          { team1Score: n1, team2Score: n2, winner, reason: reason.trim() },
          `Map ${map.number} corrected`
        )
      }
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
        <TextField
          label={`${t1} rounds`}
          value={s1}
          onChange={(e) => setS1(e.target.value)}
          inputProps={{ inputMode: 'numeric', 'data-testid': 'manage-correct-map-t1' }}
        />
        <TextField
          label={`${t2} rounds`}
          value={s2}
          onChange={(e) => setS2(e.target.value)}
          inputProps={{ inputMode: 'numeric', 'data-testid': 'manage-correct-map-t2' }}
        />
      </Box>
      <TextField
        select
        label="Map winner"
        value={winner}
        onChange={(e) => setWinner(e.target.value as 'team1' | 'team2')}
      >
        <MenuItem value="team1">{t1}</MenuItem>
        <MenuItem value="team2">{t2}</MenuItem>
      </TextField>
      <TextField
        label="Why (shown in the admin log)"
        placeholder="e.g. server crash, played on a backup"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        inputProps={{ maxLength: 300, 'data-testid': 'manage-correct-map-reason' }}
      />
      <Typography sx={{ color: color.warning, fontSize: textSize.sm }}>
        {`The series score ${same ? 'stays' : 'becomes'} ${seriesNow[0]}–${seriesNow[1]}${
          same ? '' : ` → ${after[0]}–${after[1]}`
        }. Player stats for this map are not changed.`}
      </Typography>
    </ActionDialog>
  );
}

// ---- Message all ----

/** Say something to everyone in the match: in-game chat, the centre of the screen, the site's match chat. */
export function MessageAllDialog({
  slug,
  players,
  onClose,
  send,
  onDone,
  onError,
}: {
  slug: string;
  /** Humans on the server, for the button. */
  players: number;
  onClose: () => void;
  send: (name: string, args: Record<string, Untrusted>, ok?: string) => Promise<Untrusted>;
  onDone: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [where, setWhere] = useState({ chat: true, center: true, site: true });
  const any = where.chat || where.center || where.site;
  return (
    <ActionDialog
      target="match"
      title="Message everyone in this match"
      cancel="Don’t send"
      action={`Send to all ${players} player${players === 1 ? '' : 's'}`}
      disabled={!text.trim() || !any}
      onClose={onClose}
      testId="manage-message-all"
      onRun={async () => {
        const message = text.trim();
        if (where.chat || where.center) {
          // The centre text needs the chat line with it (Ready Up's `say`).
          await send('say', {
            text: message,
            as_admin: true,
            ...(where.center ? { center_seconds: 8 } : {}),
          });
        }
        if (where.site) {
          try {
            await api.post(`/api/chat/${encodeURIComponent(`match:${slug}`)}/messages`, {
              body: message,
            });
          } catch (error) {
            onError((error as Error).message || 'The match chat refused it');
            throw error;
          }
        }
        onDone('Sent');
      }}
    >
      <TextField
        label="Message"
        multiline
        minRows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        inputProps={{ maxLength: 190, 'data-testid': 'manage-message-all-text' }}
      />
      <Box component="fieldset" sx={{ m: 0, p: 0, border: 0 }}>
        <Typography component="legend" sx={{ fontSize: textSize.sm, color: color.muted, pb: 0.5 }}>
          Where
        </Typography>
        <FormGroup row>
          <FormControlLabel
            control={
              <Checkbox
                checked={where.chat}
                onChange={(e) => setWhere({ ...where, chat: e.target.checked })}
              />
            }
            label="In-game chat"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={where.center}
                onChange={(e) => setWhere({ ...where, center: e.target.checked })}
              />
            }
            label="Center of the screen"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={where.site}
                onChange={(e) => setWhere({ ...where, site: e.target.checked })}
              />
            }
            label="Match chat on the site"
          />
        </FormGroup>
      </Box>
    </ActionDialog>
  );
}
