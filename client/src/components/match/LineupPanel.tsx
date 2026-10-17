/**
 * Who plays the match for a team bigger than the team size (a five-player
 * team in a 2v2): the team's owner or a captain ticks the players, the rest
 * sit on the bench. On the match page for the viewer's team; on ManageMatch
 * for both teams, where an admin sets either (`admin`). Open before the match
 * goes live and between maps; nothing renders for a team that fits.
 * API: /api/match-lineups (services/matchLineups.ts).
 */
import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Checkbox, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { radii, tokens } from '../../theme/tokens';
import { PlayerAvatar, h2Sx, panel } from '../tournament/ui/draftUi';

interface TeamLineup {
  side: 'team1' | 'team2';
  teamId: string;
  teamName: string;
  size: number;
  pool: Array<{ steamId: string; name: string; avatar: string | null }>;
  players: string[];
  source: 'set' | 'previous' | 'roster';
  canEdit: boolean;
}

interface Lineups {
  open: boolean;
  teams: TeamLineup[];
}

interface SaveAnswer extends Lineups {
  serverSync?: { ok: boolean; error?: string };
}

function TeamPicker({
  slug,
  team,
  open,
  admin,
  showName,
  onSaved,
}: {
  slug: string;
  team: TeamLineup;
  open: boolean;
  admin: boolean;
  showName: boolean;
  onSaved: (next: Lineups) => void;
}) {
  const { t } = useTranslation();
  const { showSuccess, showError } = useSnackbar();
  const [picked, setPicked] = useState<string[]>(team.players);
  const [busy, setBusy] = useState(false);
  const stored = team.players.join(',');
  useEffect(() => {
    setPicked(stored ? stored.split(',') : []);
  }, [stored]);

  const changed = [...picked].sort().join(',') !== [...team.players].sort().join(',');
  const toggle = (id: string) =>
    setPicked((now) =>
      now.includes(id) ? now.filter((p) => p !== id) : now.length < team.size ? [...now, id] : now
    );
  const save = async () => {
    setBusy(true);
    try {
      const res = await api.put<SaveAnswer>(
        `/api/match-lineups/${encodeURIComponent(slug)}/${team.side}`,
        { players: picked, ...(admin ? { asAdmin: true } : {}) }
      );
      if (res.serverSync && !res.serverSync.ok) {
        showError(t('lineupPanel.notOnServer', { error: res.serverSync.error ?? '' }));
      } else {
        showSuccess(t('lineupPanel.saved'));
      }
      onSaved(res);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ManageMatch: the admin sets either team's while lineups are open.
  const canEdit = team.canEdit || (admin && open);
  const titleId = `lineup-${team.side}-title`;
  return (
    <Box
      component="section"
      aria-labelledby={titleId}
      data-testid={`match-lineup-${team.side}`}
      sx={panel}
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 1,
        }}
      >
        <Typography id={titleId} component="h2" sx={h2Sx}>
          {showName ? `${t('lineupPanel.title')} · ${team.teamName}` : t('lineupPanel.title')}
        </Typography>
        <Typography component="span" sx={{ fontSize: '0.875rem', color: tokens.color.ink2 }}>
          {canEdit
            ? t('lineupPanel.picked', { picked: picked.length, count: team.size })
            : !open
              ? t('lineupPanel.locked')
              : t('lineupPanel.captainOnly')}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: '0.875rem', color: tokens.color.ink2 }}>
        {t('lineupPanel.note', { count: team.size })}
        {team.source !== 'set' && ` ${t(`lineupPanel.source.${team.source}`)}`}
      </Typography>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {team.pool.map((p) => {
          const plays = picked.includes(p.steamId);
          return (
            <Box
              component="li"
              key={p.steamId}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1.5,
                py: 0.5,
                borderTop: `1px solid ${tokens.color.rule}`,
              }}
            >
              <Box
                component={canEdit ? 'label' : 'div'}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  minWidth: 0,
                  cursor: canEdit ? 'pointer' : 'default',
                }}
              >
                {canEdit && (
                  <Checkbox
                    size="small"
                    checked={plays}
                    disabled={busy || (!plays && picked.length >= team.size)}
                    onChange={() => toggle(p.steamId)}
                    inputProps={{ 'aria-label': p.name }}
                  />
                )}
                <PlayerAvatar id={p.steamId} name={p.name} avatar={p.avatar} size={32} />
                <Typography component="span" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                  {p.name}
                </Typography>
              </Box>
              <Box
                component="span"
                sx={{
                  px: 1.25,
                  py: 0.25,
                  borderRadius: radii.pill,
                  bgcolor: tokens.color.paper3,
                  color: plays ? tokens.color.accent : tokens.color.muted,
                  fontSize: '0.75rem',
                  fontWeight: 700,
                }}
              >
                {plays ? t('lineupPanel.plays') : t('lineupPanel.bench')}
              </Box>
            </Box>
          );
        })}
      </Box>
      {canEdit && (
        <Box>
          <Button
            variant="contained"
            size="small"
            data-testid={`match-lineup-save-${team.side}`}
            disabled={busy || !changed || picked.length !== team.size}
            onClick={() => void save()}
          >
            {t('lineupPanel.save')}
          </Button>
        </Box>
      )}
    </Box>
  );
}

export function LineupPanel({
  matchSlug,
  teamId,
  admin = false,
}: {
  matchSlug: string;
  /** Only this team's lineup (the match page shows the viewer's own). */
  teamId?: string | null;
  /** ManageMatch: an admin sets either team's. */
  admin?: boolean;
}) {
  const [lineups, setLineups] = useState<Lineups | null>(null);
  const socket = useSocket();

  const load = useCallback(() => {
    api
      .get<{ success: boolean } & Lineups>(`/api/match-lineups/${encodeURIComponent(matchSlug)}`)
      .then((res) => setLineups(res))
      .catch(() => setLineups(null));
  }, [matchSlug]);
  useEffect(() => {
    load();
    // A change from the other captain or an admin, or the match going live.
    const event = `match:update:${matchSlug}`;
    socket.on(event, load);
    return () => {
      socket.off(event, load);
    };
  }, [load, socket, matchSlug]);

  const teams = (lineups?.teams ?? []).filter((team) => !teamId || team.teamId === teamId);
  if (!lineups || teams.length === 0) return null;
  return (
    <>
      {teams.map((team) => (
        <TeamPicker
          key={team.side}
          slug={matchSlug}
          team={team}
          open={lineups.open}
          admin={admin}
          showName={admin}
          onSaved={setLineups}
        />
      ))}
    </>
  );
}
