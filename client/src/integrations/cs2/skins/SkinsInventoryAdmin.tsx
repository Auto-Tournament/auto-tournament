import { useEffect, useState } from 'react';
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import { DiceFiveIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { api, useSnackbar, useModuleTranslation, tokens, radii, ConfirmDialog } from '../../../module-sdk';
import { rarityColor } from './rarity';
import { sourceLabel } from './SkinParts';
import type { OwnedSkin } from './useSkins';

const { color } = tokens;

interface AdminPlayer {
  steamId: string;
  name: string;
  avatarUrl: string | null;
  skins: number;
}

interface CatalogEntry {
  weapon: string;
  weaponName: string;
  paintKit: number;
  name: string;
  variant: string | null;
  rarity: string;
  imageUrl: string;
  /** Knives and gloves: market price in USD, which set the rarity. */
  price?: number;
}

/** The wear bands, as float ranges. A chip rolls a float inside its band. */
const WEARS = [
  { key: 'fn', min: 0, max: 0.07 },
  { key: 'mw', min: 0.07, max: 0.15 },
  { key: 'ft', min: 0.15, max: 0.38 },
  { key: 'ww', min: 0.38, max: 0.45 },
  { key: 'bs', min: 0.45, max: 1 },
] as const;

const entryLabel = (e: CatalogEntry) => `${e.weaponName} · ${e.name}${e.variant ? ` (${e.variant})` : ''}`;

/**
 * Admin: one player's inventory as a list, to give skins (an exact finish,
 * phase, float and pattern) or take them away.
 */
export function SkinsInventoryAdmin() {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [player, setPlayer] = useState<AdminPlayer | null>(null);
  const [inventory, setInventory] = useState<OwnedSkin[] | null>(null);
  const [version, setVersion] = useState(0);
  const [giveOpen, setGiveOpen] = useState(false);
  const [removing, setRemoving] = useState<OwnedSkin | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get<{ players: AdminPlayer[] }>(`/api/skins/admin/players?q=${encodeURIComponent(query)}`)
        .then((r) => !cancelled && setPlayers(r.players ?? []))
        .catch(() => !cancelled && setPlayers([]));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, version]);

  useEffect(() => {
    if (!player) return;
    let cancelled = false;
    api
      .get<{ inventory: OwnedSkin[] }>(`/api/skins/admin/players/${player.steamId}/inventory`)
      .then((r) => !cancelled && setInventory(r.inventory ?? []))
      .catch(() => !cancelled && setInventory([]));
    return () => {
      cancelled = true;
    };
  }, [player, version]);

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.delete(`/api/skins/admin/skins/${removing.id}`);
      showSuccess(t('skins.admin.inv.removed'));
      setRemoving(null);
      setVersion((v) => v + 1);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="skins-inventory-admin">
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box>
          <Typography variant="h6">{t('skins.admin.inv.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('skins.admin.inv.hint')}
          </Typography>
        </Box>

        <Autocomplete
          size="small"
          options={players}
          value={player}
          filterOptions={(x) => x}
          getOptionLabel={(p) => p.name}
          isOptionEqualToValue={(a, b) => a.steamId === b.steamId}
          onInputChange={(_, value, reason) => reason === 'input' && setQuery(value)}
          onChange={(_, value) => {
            setPlayer(value);
            setInventory(null);
          }}
          renderOption={(props, p) => (
            <Box component="li" {...props} key={p.steamId} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
              <Avatar src={p.avatarUrl ?? undefined} sx={{ width: 28, height: 28 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap>{p.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {p.steamId}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                {t('skins.count', { count: p.skins })}
              </Typography>
            </Box>
          )}
          renderInput={(params) => (
            <TextField {...params} label={t('skins.admin.inv.player')} placeholder={t('skins.admin.inv.playerHint')} />
          )}
          data-testid="skins-admin-player"
        />

        {player && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Avatar src={player.avatarUrl ?? undefined} sx={{ width: 36, height: 36 }} />
              <Box sx={{ flex: 1 }}>
                <Typography fontWeight={600}>{player.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {inventory ? t('skins.count', { count: inventory.length }) : '…'}
                </Typography>
              </Box>
              <Button variant="contained" startIcon={<PlusIcon size={16} />} onClick={() => setGiveOpen(true)} data-testid="skins-admin-give">
                {t('skins.admin.inv.give')}
              </Button>
            </Box>

            {inventory && inventory.length === 0 && (
              <Typography color="text.secondary">{t('skins.emptyTheirs')}</Typography>
            )}
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {(inventory ?? []).map((skin) => (
                <Box
                  component="li"
                  key={skin.id}
                  data-testid="skins-admin-row"
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '56px minmax(0, 1fr) auto', md: '56px minmax(0, 1fr) 150px 160px auto' },
                    alignItems: 'center',
                    gap: 1.5,
                    p: 1,
                    borderRadius: radii.md,
                    bgcolor: color.paper2,
                    borderLeft: `3px solid ${rarityColor[skin.rarity] ?? color.rule}`,
                  }}
                >
                  <Box component="img" src={skin.imageUrl} alt="" loading="lazy" sx={{ width: 56, height: 40, objectFit: 'contain' }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap fontWeight={600}>
                      {skin.weaponName} · {skin.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t(`skins.rarity.${skin.rarity}`)}
                      {skin.equipped ? ` · ${t('skins.admin.inv.equipped')}` : ''}
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ display: { xs: 'none', md: 'block' }, fontVariantNumeric: 'tabular-nums' }}>
                    {skin.float.toFixed(4)} · #{skin.pattern}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap sx={{ display: { xs: 'none', md: 'block' } }}>
                    {t(`skins.admin.inv.source.${skin.source}`)}
                    {skin.sourceLabel ? ` · ${sourceLabel(skin.sourceLabel)}` : ''}
                  </Typography>
                  <IconButton aria-label={t('skins.admin.inv.remove')} onClick={() => setRemoving(skin)} data-testid="skins-admin-remove">
                    <TrashIcon size={18} />
                  </IconButton>
                </Box>
              ))}
            </Box>
          </>
        )}
      </CardContent>

      {player && (
        <GiveSkinDialog
          open={giveOpen}
          player={player}
          onClose={() => setGiveOpen(false)}
          onGiven={() => {
            setGiveOpen(false);
            setVersion((v) => v + 1);
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={t('skins.admin.inv.removeTitle')}
        message={removing ? t('skins.admin.inv.removeQuestion', { skin: `${removing.weaponName} · ${removing.name}`, player: player?.name ?? '' }) : ''}
        confirmLabel={t('skins.admin.inv.remove')}
        confirmColor="error"
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}

/** Give one exact skin: finish, phase, float (or a wear band) and pattern. */
function GiveSkinDialog({
  open,
  player,
  onClose,
  onGiven,
}: {
  open: boolean;
  player: AdminPlayer;
  onClose: () => void;
  onGiven: () => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<CatalogEntry[]>([]);
  const [skin, setSkin] = useState<CatalogEntry | null>(null);
  const [phases, setPhases] = useState<CatalogEntry[]>([]);
  const [float, setFloat] = useState('');
  const [pattern, setPattern] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get<{ skins: CatalogEntry[] }>(`/api/skins/admin/catalog?all=1&q=${encodeURIComponent(query)}`)
        .then((r) => !cancelled && setOptions(r.skins ?? []))
        .catch(() => !cancelled && setOptions([]));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  // The other phases of the picked finish (Doppler: Ruby, Sapphire, Phase 1-4...).
  const pick = (value: CatalogEntry | null) => {
    setSkin(value);
    setPhases([]);
    if (!value?.variant) return;
    api
      .get<{ skins: CatalogEntry[] }>(`/api/skins/admin/catalog?all=1&q=${encodeURIComponent(`${value.weaponName} ${value.name}`)}`)
      .then((r) => setPhases((r.skins ?? []).filter((s) => s.weapon === value.weapon && s.name === value.name && s.variant)))
      .catch(() => setPhases([]));
  };

  const floatNumber = float.trim() === '' ? null : Number(float);
  const patternNumber = pattern.trim() === '' ? null : Number(pattern);
  const floatBad = floatNumber !== null && (!Number.isFinite(floatNumber) || floatNumber < 0 || floatNumber > 1);
  const patternBad = patternNumber !== null && (!Number.isInteger(patternNumber) || patternNumber < 0 || patternNumber > 1000);

  const give = async () => {
    if (!skin) return;
    setBusy(true);
    try {
      await api.post(`/api/skins/admin/players/${player.steamId}/skins`, {
        weapon: skin.weapon,
        paintKit: skin.paintKit,
        ...(floatNumber !== null ? { float: floatNumber } : {}),
        ...(patternNumber !== null ? { pattern: patternNumber } : {}),
      });
      showSuccess(t('skins.admin.inv.given', { player: player.name }));
      setSkin(null);
      setPhases([]);
      setFloat('');
      setPattern('');
      onGiven();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" data-testid="skins-give-dialog">
      <DialogTitle>{t('skins.admin.inv.giveTo', { player: player.name })}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
        <Autocomplete
          size="small"
          options={options}
          value={skin}
          filterOptions={(x) => x}
          getOptionLabel={entryLabel}
          isOptionEqualToValue={(a, b) => a.weapon === b.weapon && a.paintKit === b.paintKit}
          onInputChange={(_, value, reason) => reason === 'input' && setQuery(value)}
          onChange={(_, value) => pick(value)}
          renderOption={(props, o) => (
            <Box component="li" {...props} key={`${o.weapon}|${o.paintKit}`} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
              <Box component="img" src={o.imageUrl} alt="" loading="lazy" sx={{ width: 48, height: 34, objectFit: 'contain' }} />
              <Typography sx={{ flex: 1 }}>{entryLabel(o)}</Typography>
              {o.price !== undefined && (
                <Typography variant="caption" color="text.secondary">
                  ${Math.round(o.price).toLocaleString('en-US')}
                </Typography>
              )}
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: rarityColor[o.rarity] }} aria-hidden />
            </Box>
          )}
          renderInput={(params) => <TextField {...params} label={t('skins.admin.skin')} placeholder={t('skins.admin.inv.skinHint')} />}
          data-testid="skins-give-skin"
        />

        {skin && (
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Box component="img" src={skin.imageUrl} alt="" sx={{ width: 120, height: 84, objectFit: 'contain', bgcolor: color.paper3, borderRadius: radii.md, p: 1 }} />
            <Box>
              <Typography fontWeight={600}>{entryLabel(skin)}</Typography>
              <Typography variant="caption" sx={{ color: rarityColor[skin.rarity] }}>
                {t(`skins.rarity.${skin.rarity}`)}
              </Typography>
            </Box>
          </Box>
        )}

        {phases.length > 1 && (
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {t('skins.admin.inv.phase')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {phases.map((p) => (
                <Chip
                  key={p.paintKit}
                  label={p.variant}
                  onClick={() => setSkin(p)}
                  color={skin?.paintKit === p.paintKit ? 'primary' : 'default'}
                  variant={skin?.paintKit === p.paintKit ? 'filled' : 'outlined'}
                />
              ))}
            </Box>
          </Box>
        )}

        <Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t('skins.admin.inv.wear')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
            {WEARS.map((w) => {
              const active = floatNumber !== null && floatNumber >= w.min && floatNumber < (w.max === 1 ? 1.0001 : w.max);
              return (
                <Chip
                  key={w.key}
                  label={t(`skins.admin.inv.wears.${w.key}`)}
                  onClick={() => setFloat((w.min + Math.random() * (w.max - w.min)).toFixed(6))}
                  color={active ? 'primary' : 'default'}
                  variant={active ? 'filled' : 'outlined'}
                />
              );
            })}
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <TextField
              size="small"
              type="number"
              label={t('skins.admin.inv.float')}
              value={float}
              onChange={(e) => setFloat(e.target.value)}
              placeholder={t('skins.admin.random')}
              error={floatBad}
              helperText={floatBad ? t('skins.admin.inv.floatBad') : ' '}
              inputProps={{ min: 0, max: 1, step: 0.0001, 'data-testid': 'skins-give-float' }}
              InputLabelProps={{ shrink: true }}
              sx={{ width: 180 }}
            />
            <TextField
              size="small"
              type="number"
              label={t('skins.admin.inv.pattern')}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={t('skins.admin.random')}
              error={patternBad}
              helperText={patternBad ? t('skins.admin.inv.patternBad') : ' '}
              inputProps={{ min: 0, max: 1000, step: 1, 'data-testid': 'skins-give-pattern' }}
              InputLabelProps={{ shrink: true }}
              sx={{ width: 160 }}
            />
            <Button
              startIcon={<DiceFiveIcon size={16} />}
              onClick={() => setPattern(String(Math.floor(Math.random() * 1001)))}
              sx={{ mt: 0.25 }}
            >
              {t('skins.admin.inv.rollPattern')}
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary">
            {t('skins.admin.inv.emptyRolls')}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={!skin || busy || floatBad || patternBad} onClick={() => void give()} data-testid="skins-give-confirm">
          {t('skins.admin.inv.give')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
