import { useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import {
  api,
  useModuleTranslation,
  useSnackbar,
  tokens,
  panelSx,
  panelBorderSx,
} from '../../../module-sdk';
import type { OwnedSkin, Rarity } from './useSkins';
import { tradeUpTarget } from './tradeUp';
import { rarityColor } from './rarity';
import { skinCardUrl } from './SkinParts';

const { color } = tokens;

interface Outcome {
  weapon: string;
  weaponName: string;
  name: string;
  rarity: Rarity;
  imageUrl: string;
}

/**
 * The trade-up contract above the inventory grid while picking: how many are
 * picked of how many, what the next grade can give (every skin equally
 * likely), and Trade up. The grid picks (SkinCard `pick`).
 */
export function TradeUpPanel({
  count,
  picked,
  onDone,
  onCancel,
}: {
  count: number;
  picked: OwnedSkin[];
  onDone: (skinId: number) => void;
  onCancel: () => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const rarity = picked[0]?.rarity ?? null;
  const target = rarity ? tradeUpTarget(rarity) : null;
  const [outcomes, setOutcomes] = useState<{ rarity: Rarity; skins: Outcome[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!rarity) return;
    let cancelled = false;
    api
      .get<{ skins: Outcome[] }>(`/api/skins/me/trade-up?rarity=${encodeURIComponent(rarity)}`)
      .then((r) => !cancelled && setOutcomes({ rarity, skins: r.skins ?? [] }))
      .catch(() => !cancelled && setOutcomes({ rarity, skins: [] }));
    return () => {
      cancelled = true;
    };
  }, [rarity]);
  const shown = rarity && outcomes?.rarity === rarity ? outcomes.skins : [];

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ skinId: number }>('/api/skins/me/trade-up', {
        skinIds: picked.map((s) => s.id),
      });
      onDone(res.skinId);
    } catch (error) {
      showError(error instanceof Error ? error.message : t('skins.tradeUp.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      data-testid="trade-up-panel"
      sx={{
        ...panelSx,
        ...panelBorderSx,
        p: 2.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 600, flex: 1, minWidth: 0 }} data-testid="trade-up-count">
          {t('skins.tradeUp.picked', { picked: picked.length, count })}
        </Typography>
        <Button onClick={onCancel} disabled={busy}>
          {t('skins.tradeUp.cancel')}
        </Button>
        <Button
          variant="contained"
          disabled={busy || picked.length !== count}
          onClick={() => void confirm()}
          data-testid="trade-up-confirm"
        >
          {t('skins.tradeUp.confirm')}
        </Button>
      </Box>
      <Typography sx={{ fontSize: '0.875rem', color: color.ink2 }}>
        {target
          ? t('skins.tradeUp.gives', {
              rarity: t(`skins.rarity.${target}`),
              count: shown.length,
            })
          : t('skins.tradeUp.help', { count })}
      </Typography>
      {shown.length > 0 && (
        <Box
          data-testid="trade-up-outcomes"
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
            gap: 1,
            maxHeight: 220,
            overflowY: 'auto',
          }}
        >
          {shown.map((s) => (
            <Box
              key={`${s.weapon}:${s.name}`}
              title={`${s.weaponName} | ${s.name}`}
              sx={{
                borderRadius: '10px',
                border: `1px solid ${color.rule}`,
                borderBottom: `3px solid ${rarityColor[s.rarity]}`,
                p: 0.75,
                minWidth: 0,
              }}
            >
              <Box
                component="img"
                src={skinCardUrl(s.imageUrl)}
                alt=""
                loading="lazy"
                sx={{ width: '100%', height: 48, objectFit: 'contain' }}
              />
              <Typography
                sx={{
                  fontSize: '0.6875rem',
                  color: color.ink2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {s.weaponName} | {s.name}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
