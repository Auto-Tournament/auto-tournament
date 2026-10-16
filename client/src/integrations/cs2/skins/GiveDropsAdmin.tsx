import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import {
  api,
  useSnackbar,
  useModuleTranslation,
  tokens,
  radii,
  fontDisplay,
  panelSx,
  panelBorderSx,
  dialogPaperSx,
  SegmentedControl,
  PlayerAvatar,
} from '../../../module-sdk';
import type { AdminPlayerActionProps } from '../../types';

const { color } = tokens;

type Kind = 'online' | 'player' | 'team' | 'match' | 'tournament';

type Target = { kind: 'online' } | { kind: Exclude<Kind, 'online'>; id: string };

/** One thing the admin can pick: what the API takes (`id`), and what they read. */
interface Option {
  id: string;
  label: string;
  detail?: string;
  avatar?: string | null;
}

/**
 * The options for a kind, found by name: players as the admin types (the
 * player search), and teams, matches and tournaments from their lists.
 */
function useOptions(kind: Kind, query: string): { options: Option[]; loading: boolean } {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const playerQuery = kind === 'player' ? query.trim() : '';
  useEffect(() => {
    if (kind === 'online') return;
    let live = true;
    const run = async () => {
      setLoading(true);
      try {
        let next: Option[] = [];
        if (kind === 'player') {
          if (playerQuery.length >= 2) {
            const r = await api.get<{
              players?: Array<{ id: string; name: string; avatar?: string | null }>;
            }>(`/api/players/find?query=${encodeURIComponent(playerQuery)}`);
            next = (r.players ?? []).map((p) => ({
              id: p.id,
              label: p.name,
              detail: p.id,
              avatar: p.avatar,
            }));
          }
        } else if (kind === 'team') {
          const r = await api.get<{
            teams?: Array<{ id: string; name: string; tag?: string | null }>;
          }>('/api/teams');
          next = (r.teams ?? []).map((team) => ({
            id: team.id,
            label: team.name,
            detail: team.tag ?? undefined,
          }));
        } else if (kind === 'match') {
          const r = await api.get<{
            matches?: Array<{
              slug: string;
              round: number;
              matchNumber?: number;
              status: string;
              team1?: { name?: string } | null;
              team2?: { name?: string } | null;
            }>;
          }>('/api/matches');
          next = (r.matches ?? [])
            .filter((m) => m.team1?.name || m.team2?.name)
            .map((m) => ({
              id: m.slug,
              label: `${m.team1?.name ?? 'TBD'} vs ${m.team2?.name ?? 'TBD'}`,
              detail: `${m.round ? `Round ${m.round}` : 'Match'}${
                m.matchNumber ? `, match ${m.matchNumber}` : ''
              } · ${m.status}`,
            }));
        } else {
          const r = await api.get<{
            tournaments?: Array<{ id: number; name: string; status?: string }>;
          }>('/api/tournaments');
          next = (r.tournaments ?? []).map((tn) => ({
            id: String(tn.id),
            label: tn.name,
            detail: tn.status,
          }));
        }
        if (live) setOptions(next);
      } catch {
        if (live) setOptions([]);
      } finally {
        if (live) setLoading(false);
      }
    };
    // Players are searched as the admin types; the lists load once per kind.
    const timer = setTimeout(() => void run(), kind === 'player' ? 250 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [kind, playerQuery]);
  return { options, loading };
}

/**
 * "Give a drop to …?": names who get one (the API's preview), then gives.
 * `onDone` runs after a drop was given.
 */
function DropConfirm({
  target,
  open,
  onClose,
  onDone,
}: {
  target: Target | null;
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [who, setWho] = useState<{ count: number; names: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  // The caller's close, without re-asking the preview when it is a new function.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !target) return;
    let live = true;
    api
      .post<{ count: number; names: string[] }>('/api/skins/admin/drops', {
        target,
        preview: true,
      })
      .then((r) => live && setWho({ count: r.count, names: r.names }))
      .catch((error) => {
        if (!live) return;
        showError(error instanceof Error ? error.message : String(error));
        closeRef.current();
      });
    return () => {
      live = false;
      setWho(null);
    };
  }, [open, target, showError]);

  const give = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const r = await api.post<{ given: number }>('/api/skins/admin/drops', { target });
      showSuccess(t('skins.admin.drops.given', { count: r.given }));
      onClose();
      onDone?.();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const title = (count: number) =>
    !target || target.kind === 'player'
      ? t('skins.admin.drops.whoPlayer', { count })
      : target.kind === 'online'
        ? t('skins.admin.drops.whoOnline', { count })
        : target.kind === 'team'
          ? t('skins.admin.drops.whoTeam', { count })
          : target.kind === 'match'
            ? t('skins.admin.drops.whoMatch', { count })
            : t('skins.admin.drops.whoTournament', { count });

  return (
    <Dialog
      open={open && who !== null}
      onClose={onClose}
      PaperProps={{
        sx: dialogPaperSx,
      }}
      data-testid="give-drops-confirm"
    >
      {who && (
        <>
          <DialogTitle sx={{ fontFamily: fontDisplay }}>{title(who.count)}</DialogTitle>
          <DialogContent>
            <Typography sx={{ color: color.ink2, fontSize: '0.875rem' }}>
              {who.count === 0
                ? t('skins.admin.drops.nobody')
                : who.names.slice(0, 20).join(', ') +
                  (who.names.length > 20 ? ` +${who.names.length - 20}` : '')}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t('skins.admin.drops.cancel')}</Button>
            <Button
              variant="contained"
              disabled={busy || who.count === 0}
              onClick={() => void give()}
              data-testid="give-drops-give"
              sx={{ borderRadius: radii.pill }}
            >
              {t('skins.admin.drops.give', { count: who.count })}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}

/** Manage → Players, a player's row: "Give a drop" straight to them. */
export function GiveDropToPlayer({ player, onClose }: AdminPlayerActionProps) {
  const target = useMemo<Target>(() => ({ kind: 'player', id: player.id }), [player.id]);
  return <DropConfirm target={target} open onClose={onClose} />;
}

/**
 * Give a drop now (a choice of three) to one player, everyone online, a
 * team, a match's players or everyone who took part in a tournament, each
 * picked by name. It asks first, naming who gets one; each drop waits for
 * its player and opens on their next page view.
 */
export function GiveDropsAdmin({ onGiven }: { onGiven?: () => void }) {
  const { t } = useModuleTranslation('cs2');
  const [kind, setKind] = useState<Kind>('online');
  const [picked, setPicked] = useState<Option | null>(null);
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState(false);
  const { options, loading } = useOptions(kind, query);

  const target = useMemo<Target | null>(
    () => (kind === 'online' ? { kind } : picked ? { kind, id: picked.id } : null),
    [kind, picked]
  );

  return (
    <Box
      component="section"
      aria-labelledby="give-drops-title"
      data-testid="give-drops"
      sx={{
        ...panelSx,
        ...panelBorderSx,
        p: { xs: 2, md: 3 },
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 0,
      }}
    >
      <Box>
        <Typography
          id="give-drops-title"
          component="h2"
          sx={{ fontFamily: fontDisplay, fontSize: '1.1875rem', fontWeight: 600 }}
        >
          {t('skins.admin.drops.title')}
        </Typography>
        <Typography sx={{ fontSize: '0.875rem', color: color.ink2 }}>
          {t('skins.admin.drops.help')}
        </Typography>
      </Box>
      <SegmentedControl<Kind>
        size="small"
        label={t('skins.admin.drops.title')}
        value={kind}
        onChange={(v) => {
          setKind(v);
          setPicked(null);
          setQuery('');
        }}
        options={(['online', 'player', 'team', 'match', 'tournament'] as const).map((k) => ({
          value: k,
          label: t(`skins.admin.drops.kind.${k}`),
          testId: `give-drops-${k}`,
        }))}
      />
      {kind !== 'online' && (
        <Autocomplete
          size="small"
          options={options}
          loading={loading}
          value={picked}
          onChange={(_, v) => setPicked(v)}
          inputValue={query}
          onInputChange={(_, v) => setQuery(v)}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          getOptionLabel={(o) => o.label}
          // Players come filtered from the search; the lists filter here, by name or detail.
          filterOptions={
            kind === 'player'
              ? (o) => o
              : (o, state) => {
                  const q = state.inputValue.trim().toLowerCase();
                  return q
                    ? o.filter((x) => `${x.label} ${x.detail ?? ''}`.toLowerCase().includes(q))
                    : o;
                }
          }
          noOptionsText={
            kind === 'player' && query.trim().length < 2
              ? t('skins.admin.drops.typeName')
              : t('skins.admin.drops.noneFound')
          }
          renderOption={(props, o) => (
            <Box component="li" {...props} key={o.id} sx={{ display: 'flex', gap: 1.25 }}>
              {kind === 'player' && <PlayerAvatar name={o.label} avatarUrl={o.avatar} size={24} />}
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.9375rem' }}>{o.label}</Typography>
                {o.detail && (
                  <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
                    {o.detail}
                  </Typography>
                )}
              </Box>
            </Box>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              label={t(`skins.admin.drops.pick.${kind}`)}
              inputProps={{ ...params.inputProps, 'data-testid': 'give-drops-pick' }}
            />
          )}
          sx={{ maxWidth: 420 }}
        />
      )}
      <Box>
        <Button
          variant="contained"
          disabled={!target}
          onClick={() => setConfirming(true)}
          data-testid="give-drops-start"
          sx={{ borderRadius: radii.pill }}
        >
          {t('skins.admin.drops.start')}
        </Button>
      </Box>

      <DropConfirm
        target={target}
        open={confirming}
        onClose={() => setConfirming(false)}
        onDone={onGiven}
      />
    </Box>
  );
}
