/**
 * Admins on the Play page: who is searching right now, open lobbies, and the
 * last day's cooldowns, which they can clear (GET /api/matchmaking/admin/queue).
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Panel, SectionHead } from '../common/ui';
import { api, apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';

interface AdminQueue {
  searching: Array<{ partyId: string; mode: string; waited: number; players: Array<{ id: string; name: string }> }>;
  lobbies: Array<{ id: string; mode: string; status: string; matchSlug: string | null; map: string | null; accepted: number; total: number }>;
  penalties: Array<{ id: number; playerId: string; name: string; kind: string; cooldownUntil: number; cleared: boolean }>;
}

const minutes = (seconds: number) => Math.max(0, Math.round(seconds / 60));

export function AdminQueuePanel() {
  const { t } = useTranslation();
  const { showError, showSuccess } = useSnackbar();
  const [queue, setQueue] = useState<AdminQueue | null>(null);
  // When it was read: "minutes left" is counted from there (it refreshes every 5 s).
  const [readAt, setReadAt] = useState(0);

  const load = useCallback(async () => {
    try {
      setQueue(await api.get<AdminQueue>('/api/matchmaking/admin/queue'));
      setReadAt(Date.now() / 1000);
    } catch {
      setQueue(null);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), 5000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  const clear = async (playerId: string) => {
    try {
      await api.fetch(`/api/matchmaking/admin/players/${encodeURIComponent(playerId)}/cooldown`, {
        method: 'DELETE',
        body: '{}',
      });
      showSuccess(t('matchmaking.admin.cleared'));
      void load();
    } catch (error) {
      showError(apiErrorMessage(error, t('matchmaking.admin.clearFailed')));
    }
  };

  if (!queue) return null;
  const now = readAt;
  const active = queue.penalties.filter((p) => !p.cleared && p.cooldownUntil > now);

  return (
    <Panel sx={{ p: 3 }} data-testid="mm-admin-queue">
      <SectionHead title={t('matchmaking.admin.title')} />
      <Typography color="text.secondary" mb={2}>
        {t('matchmaking.admin.summary', {
          players: queue.searching.reduce((n, p) => n + p.players.length, 0),
          lobbies: queue.lobbies.length,
        })}
      </Typography>
      <Stack spacing={1} mb={2}>
        {queue.searching.map((p) => (
          <Typography key={p.partyId} variant="body2">
            {p.players.map((x) => x.name).join(', ')} · {p.mode} · {t('matchmaking.admin.waited', { minutes: minutes(p.waited) })}
          </Typography>
        ))}
        {queue.lobbies.map((l) => (
          <Typography key={l.id} variant="body2">
            {t(`matchmaking.room.status.${l.status}`, { defaultValue: l.status })} · {l.accepted}/{l.total}
            {l.map ? ` · ${l.map}` : ''}
            {l.matchSlug ? ` · ${l.matchSlug}` : ''}
          </Typography>
        ))}
      </Stack>
      {active.length > 0 && (
        <>
          <Typography variant="subtitle2" mb={1}>
            {t('matchmaking.admin.cooldowns')}
          </Typography>
          <Stack spacing={1}>
            {active.map((p) => (
              <Stack key={p.id} direction="row" spacing={2} alignItems="center">
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {p.name} · {t(`matchmaking.admin.kind.${p.kind}`, { defaultValue: p.kind })} ·{' '}
                  {t('matchmaking.admin.until', { minutes: minutes(p.cooldownUntil - now) })}
                </Typography>
                <Button size="small" onClick={() => void clear(p.playerId)} data-testid={`mm-clear-${p.playerId}`}>
                  {t('matchmaking.admin.clear')}
                </Button>
              </Stack>
            ))}
          </Stack>
        </>
      )}
    </Panel>
  );
}
