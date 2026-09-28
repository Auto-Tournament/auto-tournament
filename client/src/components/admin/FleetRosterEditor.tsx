/**
 * Mid-match roster edits for a match on a Ready Up fleet server (FLEET.md
 * §7.3 `match.update`): add or remove a player, substitute one for another,
 * rename a team. Every change is one compare-and-set update on the match's
 * `config_rev`; a conflict (someone else changed the config first) reloads
 * the roster and says so, and nothing is applied.
 *
 * A match that is not on a fleet server gets `fallback` instead (the RCON
 * "add player" form).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ArrowsLeftRightIcon, UserMinusIcon, UserPlusIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';

type TeamKey = 'team1' | 'team2';
type Target = TeamKey | 'spectator';

interface RosterPlayer {
  steamid64: string;
  name: string;
  role: 'player' | 'sub' | 'coach' | null;
  connected: boolean | null;
}

interface RosterInfo {
  success: boolean;
  fleet: boolean;
  serverId: string | null;
  online: boolean;
  epoch: number;
  configRev: number;
  roster: {
    team1: { name: string; players: RosterPlayer[] };
    team2: { name: string; players: RosterPlayer[] };
    spectators: RosterPlayer[];
    source: 'live' | 'config';
  } | null;
  updates: Array<{ id: string; status: string; errorCode: string | null; createdAt: number }>;
}

type Op =
  | {
      op: 'add_player';
      team: Target;
      steamid64: string;
      name: string;
      role?: 'player' | 'sub' | 'coach';
    }
  | { op: 'remove_player'; steamid64: string }
  | { op: 'rename_team'; team: TeamKey; name: string };

interface UpdateAnswer {
  success: boolean;
  status?: string;
  code?: string;
  error?: string;
  configRev?: number;
  errorCode?: string | null;
  message?: string | null;
}

const STEAM64 = /^\d{17}$/;

function parseError(err: unknown): UpdateAnswer {
  const raw = err instanceof Error ? err.message : '';
  try {
    return JSON.parse(raw) as UpdateAnswer;
  } catch {
    return { success: false, error: raw || undefined };
  }
}

interface Props {
  matchSlug: string;
  /** Shown instead when the match is not on a fleet server. */
  fallback?: React.ReactNode;
  onSuccess?: (message: string) => void;
}

export const FleetRosterEditor: React.FC<Props> = ({ matchSlug, fallback, onSuccess }) => {
  const { t } = useTranslation();
  const [info, setInfo] = useState<RosterInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    severity: 'success' | 'info' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [names, setNames] = useState<Record<TeamKey, string>>({ team1: '', team2: '' });
  const [add, setAdd] = useState<{
    steamid64: string;
    name: string;
    team: Target;
    role: 'player' | 'sub' | 'coach';
  }>({
    steamid64: '',
    name: '',
    team: 'team1',
    role: 'player',
  });
  const [sub, setSub] = useState<{
    out: RosterPlayer;
    team: Target;
    steamid64: string;
    name: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<RosterInfo>(
        `/api/fleet/matches/${encodeURIComponent(matchSlug)}/roster`
      );
      setInfo(res);
      if (res.roster) setNames({ team1: res.roster.team1.name, team2: res.roster.team2.name });
    } catch {
      setInfo(null);
    } finally {
      setLoaded(true);
    }
  }, [matchSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded) return null;
  if (!info?.fleet || !info.roster) return <>{fallback ?? null}</>;
  const roster = info.roster;

  const send = async (ops: Op[], okText: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.post<UpdateAnswer>(
        `/api/fleet/matches/${encodeURIComponent(matchSlug)}/update`,
        {
          ops,
          baseConfigRev: info.configRev,
        }
      );
      if (res.status === 'pending') {
        setNotice({
          severity: 'info',
          text: t('fleetRoster.pending', {
            defaultValue:
              'Sent; the server has not answered yet. It applies the change when it gets it.',
          }),
        });
      } else {
        setNotice({ severity: 'success', text: okText });
        onSuccess?.(okText);
      }
    } catch (err) {
      const answer = parseError(err);
      if (answer.code === 'conflict' || answer.code === 'stale') {
        setNotice({
          severity: 'warning',
          text: t('fleetRoster.conflict', {
            rev: answer.configRev ?? '?',
            defaultValue:
              'Not applied: the match config changed meanwhile (now rev {{rev}}). The roster was reloaded; check it and try again.',
          }),
        });
      } else {
        const detail = [answer.errorCode ?? answer.code, answer.message ?? answer.error]
          .filter(Boolean)
          .join(': ');
        setNotice({
          severity: 'error',
          text: t('fleetRoster.failed', {
            detail,
            defaultValue: 'The server refused the change: {{detail}}',
          }),
        });
      }
    } finally {
      setBusy(false);
      await load();
    }
  };

  const teamLabel = (team: Target) =>
    team === 'spectator'
      ? t('fleetRoster.spectators', { defaultValue: 'Spectators' })
      : roster[team].name || team;

  const addValid = STEAM64.test(add.steamid64.trim()) && add.name.trim().length > 0;
  const subValid = sub !== null && STEAM64.test(sub.steamid64.trim()) && sub.name.trim().length > 0;

  const playerRow = (p: RosterPlayer, team: Target) => (
    <Stack key={p.steamid64} direction="row" alignItems="center" gap={1} py={0.5}>
      <Box
        component="span"
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          flex: 'none',
          bgcolor: p.connected ? 'success.main' : 'action.disabled',
        }}
        aria-hidden
      />
      <Box minWidth={0} flex={1}>
        <Typography variant="body2" noWrap>
          {p.name}
          {p.role && p.role !== 'player' ? ` (${p.role})` : ''}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
          {p.steamid64}
        </Typography>
      </Box>
      {team !== 'spectator' && (
        <Button
          size="small"
          startIcon={<ArrowsLeftRightIcon />}
          disabled={busy}
          onClick={() => setSub({ out: p, team, steamid64: '', name: '' })}
        >
          {t('fleetRoster.substitute', { defaultValue: 'Substitute' })}
        </Button>
      )}
      <Button
        size="small"
        color="error"
        startIcon={<UserMinusIcon />}
        disabled={busy}
        onClick={() =>
          void send(
            [{ op: 'remove_player', steamid64: p.steamid64 }],
            t('fleetRoster.removed', { name: p.name, defaultValue: '{{name}} removed' })
          )
        }
        data-testid={`fleet-roster-remove-${p.steamid64}`}
      >
        {t('fleetRoster.remove', { defaultValue: 'Remove' })}
      </Button>
    </Stack>
  );

  return (
    <Box data-testid="fleet-roster-editor">
      <Stack direction="row" alignItems="center" gap={1} mb={1} flexWrap="wrap">
        <Typography variant="subtitle1" fontWeight={600}>
          {t('fleetRoster.title', { defaultValue: 'Roster (Ready Up)' })}
        </Typography>
        <Chip
          size="small"
          label={t('fleetRoster.rev', { rev: info.configRev, defaultValue: 'config rev {{rev}}' })}
        />
        <Chip
          size="small"
          color={info.online ? 'success' : 'default'}
          variant={info.online ? 'filled' : 'outlined'}
          label={
            info.online
              ? t('fleetRoster.online', { defaultValue: 'server online' })
              : t('fleetRoster.offline', { defaultValue: 'server offline' })
          }
        />
      </Stack>
      <Typography variant="body2" color="text.secondary" mb={2}>
        {t('fleetRoster.help', {
          defaultValue:
            'Changes go to the server as one update each; it applies all of it or nothing. Removing a connected player does not kick them until the server enforces the roster.',
        })}
      </Typography>

      {notice && (
        <Alert
          severity={notice.severity}
          sx={{ mb: 2 }}
          onClose={() => setNotice(null)}
          data-testid="fleet-roster-notice"
        >
          {notice.text}
        </Alert>
      )}

      <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '1fr 1fr' }} gap={2} mb={2}>
        {(['team1', 'team2'] as const).map((team) => (
          <Box key={team}>
            <Stack direction="row" gap={1} alignItems="center" mb={1}>
              <TextField
                size="small"
                fullWidth
                label={
                  team === 'team1'
                    ? t('fleetRoster.team1', { defaultValue: 'Team 1' })
                    : t('fleetRoster.team2', { defaultValue: 'Team 2' })
                }
                value={names[team]}
                onChange={(e) => setNames({ ...names, [team]: e.target.value })}
                inputProps={{ maxLength: 64 }}
              />
              <Button
                size="small"
                disabled={busy || !names[team].trim() || names[team].trim() === roster[team].name}
                onClick={() =>
                  void send(
                    [{ op: 'rename_team', team, name: names[team].trim() }],
                    t('fleetRoster.renamed', {
                      name: names[team].trim(),
                      defaultValue: 'Renamed to {{name}}',
                    })
                  )
                }
              >
                {t('fleetRoster.rename', { defaultValue: 'Rename' })}
              </Button>
            </Stack>
            {roster[team].players.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t('fleetRoster.empty', { defaultValue: 'No players' })}
              </Typography>
            ) : (
              roster[team].players.map((p) => playerRow(p, team))
            )}
          </Box>
        ))}
      </Box>
      {roster.spectators.length > 0 && (
        <Box mb={2}>
          <Typography variant="subtitle2" fontWeight={600}>
            {teamLabel('spectator')}
          </Typography>
          {roster.spectators.map((p) => playerRow(p, 'spectator'))}
        </Box>
      )}

      <Typography variant="subtitle2" fontWeight={600} mb={1}>
        {t('fleetRoster.addTitle', { defaultValue: 'Add a player' })}
      </Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} gap={1} mb={2}>
        <TextField
          size="small"
          label="SteamID64"
          value={add.steamid64}
          onChange={(e) => setAdd({ ...add, steamid64: e.target.value })}
          inputProps={{ 'data-testid': 'fleet-roster-add-steamid' }}
        />
        <TextField
          size="small"
          label={t('fleetRoster.name', { defaultValue: 'Name' })}
          value={add.name}
          onChange={(e) => setAdd({ ...add, name: e.target.value })}
          inputProps={{ maxLength: 128 }}
        />
        <TextField
          select
          size="small"
          value={add.team}
          onChange={(e) => setAdd({ ...add, team: e.target.value as Target })}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="team1">{teamLabel('team1')}</MenuItem>
          <MenuItem value="team2">{teamLabel('team2')}</MenuItem>
          <MenuItem value="spectator">{teamLabel('spectator')}</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          value={add.role}
          onChange={(e) => setAdd({ ...add, role: e.target.value as 'player' | 'sub' | 'coach' })}
          sx={{ minWidth: 110 }}
          disabled={add.team === 'spectator'}
        >
          <MenuItem value="player">
            {t('fleetRoster.role.player', { defaultValue: 'Player' })}
          </MenuItem>
          <MenuItem value="sub">{t('fleetRoster.role.sub', { defaultValue: 'Sub' })}</MenuItem>
          <MenuItem value="coach">
            {t('fleetRoster.role.coach', { defaultValue: 'Coach' })}
          </MenuItem>
        </TextField>
        <Button
          variant="contained"
          startIcon={<UserPlusIcon />}
          disabled={busy || !addValid}
          onClick={() => {
            const op: Op = {
              op: 'add_player',
              team: add.team,
              steamid64: add.steamid64.trim(),
              name: add.name.trim(),
              ...(add.team !== 'spectator' ? { role: add.role } : {}),
            };
            void send(
              [op],
              t('fleetRoster.added', {
                name: add.name.trim(),
                target: teamLabel(add.team),
                defaultValue: '{{name}} added to {{target}}',
              })
            ).then(() => setAdd({ ...add, steamid64: '', name: '' }));
          }}
          data-testid="fleet-roster-add"
        >
          {t('fleetRoster.add', { defaultValue: 'Add' })}
        </Button>
      </Stack>

      {info.updates.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t('fleetRoster.recent', { defaultValue: 'Recent updates' })}
          </Typography>
          <Box>
            {info.updates.map((u) => (
              <Chip
                key={u.id}
                size="small"
                variant="outlined"
                color={
                  u.status === 'ok' ? 'success' : u.status === 'pending' ? 'default' : 'warning'
                }
                label={`${new Date(u.createdAt * 1000).toLocaleTimeString()} ${u.errorCode ?? u.status}`}
                sx={{ mr: 0.5, mt: 0.5 }}
              />
            ))}
          </Box>
        </Box>
      )}

      <Dialog open={sub !== null} onClose={() => setSub(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {t('fleetRoster.subTitle', {
            name: sub?.out.name ?? '',
            defaultValue: 'Substitute {{name}}',
          })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('fleetRoster.subHelp', {
              defaultValue:
                'The new player takes the same team and role, in the same update as the removal.',
            })}
          </Typography>
          <Stack gap={2}>
            <TextField
              size="small"
              label="SteamID64"
              value={sub?.steamid64 ?? ''}
              onChange={(e) => sub && setSub({ ...sub, steamid64: e.target.value })}
            />
            <TextField
              size="small"
              label={t('fleetRoster.name', { defaultValue: 'Name' })}
              value={sub?.name ?? ''}
              onChange={(e) => sub && setSub({ ...sub, name: e.target.value })}
              inputProps={{ maxLength: 128 }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSub(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={busy || !subValid}
            onClick={() => {
              if (!sub) return;
              const ops: Op[] = [
                { op: 'remove_player', steamid64: sub.out.steamid64 },
                {
                  op: 'add_player',
                  team: sub.team,
                  steamid64: sub.steamid64.trim(),
                  name: sub.name.trim(),
                  ...(sub.out.role ? { role: sub.out.role } : {}),
                },
              ];
              const text = t('fleetRoster.substituted', {
                out: sub.out.name,
                in: sub.name.trim(),
                defaultValue: '{{in}} in for {{out}}',
              });
              setSub(null);
              void send(ops, text);
            }}
          >
            {t('fleetRoster.substitute', { defaultValue: 'Substitute' })}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
