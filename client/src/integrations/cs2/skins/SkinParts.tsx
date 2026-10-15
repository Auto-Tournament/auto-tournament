import { useEffect, useState, type DragEvent } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, ButtonBase, Dialog, IconButton, Link, Typography } from '@mui/material';
import {
  WarningIcon,
  EyeIcon,
  PlayCircleIcon,
  PlusIcon,
  TrophyIcon,
  XIcon,
} from '@phosphor-icons/react';
import {
  api,
  useModuleTranslation,
  tokens,
  fontDisplay,
  mono,
  radii,
  withAlpha,
} from '../../../module-sdk';
import { wearKey, type OwnedSkin } from './useSkins';
import { rarityColor } from './rarity';
import { formatOdds } from './odds';
import { playerInventoryPath } from './paths';
import { getMapDisplayName } from '../maps/mapData';

const { color } = tokens;

/** "Mirage" for a map id, the label itself for a tournament name. */
export function sourceLabel(label: string): string {
  return /^(de|cs|ar|dz)_/.test(label) ? getMapDisplayName(label) : label;
}

/** The fixed notice: skins exist only here. Admins cannot change it. */
export function VirtualNotice({ compact = false }: { compact?: boolean }) {
  const { t } = useModuleTranslation('cs2');
  // A warning, not a footnote: players (kids too) must not think a real CS2 skin is being given
  // away, by this site or by anyone running a tournament on it.
  return (
    <Box
      data-testid="skins-notice"
      role="note"
      sx={{
        // Wraps on a narrow inventory instead of being cut off (a pill can't hold two lines).
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        gap: 1.25,
        px: compact ? 1.5 : 2,
        py: compact ? 1 : 1.25,
        borderRadius: radii.lg,
        bgcolor: withAlpha(color.warning, 0.1),
        border: `1px solid ${withAlpha(color.warning, 0.5)}`,
        fontSize: '0.8125rem',
        color: color.ink,
      }}
    >
      <WarningIcon size={18} weight="fill" color={color.warning} aria-hidden />
      <Box component="span" sx={{ flex: '1 1 16rem', minWidth: 0 }}>
        <Box component="strong" sx={{ fontWeight: 700 }}>
          {t('skins.notReal')}
        </Box>{' '}
        {t('skins.notice')}
      </Box>
      {!compact && <WhatThisMeans />}
    </Box>
  );
}

/** "What this means": the virtual skins rule in plain words (board 1's banner link). */
function WhatThisMeans() {
  const { t } = useModuleTranslation('cs2');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Box
        component="button"
        type="button"
        onClick={() => setOpen(true)}
        data-testid="skins-notice-more"
        sx={{
          all: 'unset',
          cursor: 'pointer',
          color: color.accent,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          '&:focus-visible': { outline: `2px solid ${color.focus}` },
        }}
      >
        {t('skins.whatThisMeans')}
      </Box>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        PaperProps={{
          sx: {
            borderRadius: radii.lg,
            bgcolor: color.paper2,
            backgroundImage: 'none',
            maxWidth: 460,
          },
        }}
      >
        <Box sx={{ p: 3.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography
            component="h2"
            sx={{ fontFamily: fontDisplay, fontSize: '1.375rem', fontWeight: 600 }}
          >
            {t('skins.whatThisMeans')}
          </Typography>
          {(['platformOnly', 'noValue', 'notInGame', 'servers'] as const).map((key) => (
            <Typography key={key} sx={{ color: color.ink2 }}>
              {t(`skins.meaning.${key}`)}
            </Typography>
          ))}
          <Button
            onClick={() => setOpen(false)}
            sx={{ alignSelf: 'flex-end', borderRadius: radii.pill }}
          >
            {t('skins.close')}
          </Button>
        </Box>
      </Dialog>
    </>
  );
}

/** The skin picture on a dark tile. */
export function SkinImage({ skin, height }: { skin: Pick<OwnedSkin, 'imageUrl'>; height: number }) {
  return (
    <Box
      component="img"
      src={skin.imageUrl}
      alt=""
      loading="lazy"
      sx={{
        width: '100%',
        height,
        objectFit: 'contain',
        bgcolor: color.paper3,
        p: 1.25,
        boxSizing: 'border-box',
        display: 'block',
      }}
    />
  );
}

/**
 * One skin in a grid (board 1): picture, weapon, name and a rarity bar. A
 * click equips it, and a click on the equipped one takes it off; equipped
 * skins carry an orange ring just outside the card and a tick. The eye
 * opens the skin.
 */
export function SkinCard({
  skin,
  onEquip,
  onInspect,
  showNew = false,
  pick,
  onDragSkin,
}: {
  skin: OwnedSkin;
  onEquip?: (skin: OwnedSkin) => void;
  /** Dragging onto a loadout slot equips it there: called with the skin, then null when the drag ends. */
  onDragSkin?: (skin: OwnedSkin | null) => void;
  onInspect: (skin: OwnedSkin) => void;
  showNew?: boolean;
  /** Trade-up picking: a click picks or unpicks instead of equipping. */
  pick?: { picked: boolean; disabled: boolean; onToggle: (skin: OwnedSkin) => void };
}) {
  const { t } = useModuleTranslation('cs2');
  return (
    <Box sx={{ position: 'relative', display: 'flex' }}>
      <ButtonBase
        onClick={() => (pick ? pick.onToggle(skin) : onEquip ? onEquip(skin) : onInspect(skin))}
        disabled={pick?.disabled}
        draggable={!!onDragSkin && !pick}
        onDragStart={
          onDragSkin && !pick
            ? (e: DragEvent) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(skin.id));
                onDragSkin(skin);
              }
            : undefined
        }
        onDragEnd={onDragSkin ? () => onDragSkin(null) : undefined}
        aria-label={
          pick
            ? t(pick.picked ? 'skins.tradeUp.unpickLabel' : 'skins.tradeUp.pickLabel', {
                name: skin.name,
              })
            : onEquip
              ? skin.equipped
                ? t('skins.unequipLabel', { name: skin.name })
                : t('skins.equipLabel', { name: skin.name })
              : skin.name
        }
        aria-pressed={pick ? pick.picked : onEquip ? skin.equipped : undefined}
        data-testid="skin-card"
        data-equipped={skin.equipped ? 'true' : 'false'}
        sx={{
          flex: 1,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          textAlign: 'left',
          borderRadius: '16px',
          overflow: 'hidden',
          bgcolor: color.paper2,
          border: `1px solid ${color.rule}`,
          ...(pick?.picked && { outline: `3px solid ${color.accent}`, outlineOffset: '2px' }),
          ...(pick?.disabled && { opacity: 0.35 }),
          '&:hover': { borderColor: color.muted },
          '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: '3px' },
        }}
      >
        <SkinImage skin={skin} height={96} />
        <Typography
          sx={{
            fontSize: '0.75rem',
            color: color.muted,
            px: 1.5,
            pt: 1.25,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {skin.stattrak !== null && skin.stattrak !== undefined && (
            <Box component="span" data-testid="skin-card-stattrak" sx={{ color: color.accent }}>
              {t('skins.stattrak')}{' '}
            </Box>
          )}
          {skin.weaponName}
        </Typography>
        <Typography
          sx={{
            fontWeight: 600,
            fontSize: '0.875rem',
            px: 1.5,
            pt: 0.25,
            pb: 1.5,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {skin.name}
        </Typography>
        <Box sx={{ mt: 'auto', height: 3, bgcolor: rarityColor[skin.rarity] }} />
      </ButtonBase>
      {skin.equipped && (
        <Box
          data-testid="skin-card-sides"
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            height: 24,
            px: 1,
            borderRadius: radii.pill,
            bgcolor: withAlpha(color.paper, 0.85),
            border: `1px solid ${color.rule}`,
            color: color.ink,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            fontSize: '0.6875rem',
            fontWeight: 600,
          }}
        >
          {/* A dot per side it is on (CT blue, T amber), then the words. */}
          {equippedOn(skin).map((team) => (
            <Box
              key={team}
              aria-hidden
              data-testid={`skin-card-side-${team === 3 ? 'ct' : 't'}`}
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: team === 3 ? color.sideCt : color.sideT,
              }}
            />
          ))}
          {sidesLabel(skin, t)}
        </Box>
      )}
      {showNew && !skin.seen && (
        <Box
          sx={{
            position: 'absolute',
            top: 10,
            left: 10,
            px: 1,
            py: '2px',
            borderRadius: radii.pill,
            bgcolor: color.accent,
            color: color.accentInk,
            fontSize: '0.6875rem',
            fontWeight: 700,
          }}
        >
          {t('skins.new')}
        </Box>
      )}
      <IconButton
        className="inspect"
        aria-label={t('skins.inspect', { name: skin.name })}
        onClick={() => onInspect(skin)}
        data-testid="skin-card-inspect"
        sx={{
          position: 'absolute',
          top: 8,
          left: showNew && !skin.seen ? 56 : 8,
          width: 32,
          height: 32,
          bgcolor: withAlpha(color.paper2, 0.85),
          border: `1px solid ${color.rule}`,
          '&:hover': { bgcolor: color.paper3 },
        }}
      >
        <EyeIcon size={16} />
      </IconButton>
    </Box>
  );
}

/** The sides a skin is on, CT first: a one-side weapon its side, "both" as CT and T. */
export function equippedOn(skin: Pick<OwnedSkin, 'equippedSides' | 'side'>): Array<2 | 3> {
  if (skin.side !== null) return [skin.side];
  if (skin.equippedSides.includes(0)) return [3, 2];
  return ([3, 2] as const).filter((s) => skin.equippedSides.includes(s));
}

/** Where a skin is on: "Both", "CT", "T", or "CT · T"; a one-side weapon names its side. */
export function sidesLabel(
  skin: Pick<OwnedSkin, 'equippedSides' | 'side'>,
  t: (key: string) => string
): string {
  const name = (team: 2 | 3) => (team === 3 ? t('skins.side.ct') : t('skins.side.t'));
  if (skin.side !== null) return name(skin.side);
  if (skin.equippedSides.includes(0)) return t('skins.side.both');
  return ([3, 2] as const)
    .filter((s) => skin.equippedSides.includes(s))
    .map(name)
    .join(' · ');
}

/** A loadout slot: the equipped skin's picture, or a plus when empty. */
export function SlotTile({
  label,
  skin,
  onClick,
  onDrop,
  onTakeOff,
  takeOffLabel,
}: {
  label: string;
  skin: OwnedSkin | null;
  onClick?: () => void;
  /** Set while a skin that fits this slot is being dragged: dropping equips it here. */
  onDrop?: () => void;
  /** Takes the skin off this side in one click (the x in the corner of an equipped slot). */
  onTakeOff?: () => void;
  takeOffLabel?: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <Box sx={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <Box
        data-testid="loadout-slot"
        data-drop-target={onDrop ? 'true' : undefined}
        component={onClick ? 'button' : 'div'}
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        onDragOver={
          onDrop
            ? (e: DragEvent) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setOver(true);
              }
            : undefined
        }
        onDragLeave={onDrop ? () => setOver(false) : undefined}
        onDrop={
          onDrop
            ? (e: DragEvent) => {
                e.preventDefault();
                setOver(false);
                onDrop();
              }
            : undefined
        }
        aria-label={
          onClick ? (skin ? `${label}: ${skin.weaponName} ${skin.name}` : label) : undefined
        }
        sx={{
          ...(onClick
            ? {
                all: 'unset',
                cursor: 'pointer',
                boxSizing: 'border-box',
                '&:hover': { borderColor: color.muted },
                '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
              }
            : {}),
          borderRadius: '14px',
          overflow: 'hidden',
          bgcolor: color.paper2,
          border: `1px ${skin ? 'solid' : 'dashed'} ${skin ? rarityColor[skin.rarity] : color.rule}`,
          display: 'flex',
          flexDirection: 'column',
          ...(onDrop && {
            outline: `2px dashed ${over ? color.accent : color.muted}`,
            outlineOffset: 2,
          }),
        }}
      >
        {skin ? (
          <Box
            component="img"
            src={skin.imageUrl}
            alt=""
            sx={{
              width: '100%',
              height: 64,
              objectFit: 'contain',
              bgcolor: color.paper3,
              p: 0.75,
              boxSizing: 'border-box',
            }}
          />
        ) : (
          <Box
            sx={{
              height: 64,
              display: 'grid',
              placeItems: 'center',
              bgcolor: color.paper3,
              color: color.muted,
            }}
            aria-hidden
          >
            <PlusIcon size={20} />
          </Box>
        )}
        <Typography
          sx={{
            fontSize: '0.75rem',
            color: color.muted,
            px: 1.25,
            py: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </Typography>
      </Box>
      {skin && onTakeOff && (
        <IconButton
          aria-label={takeOffLabel}
          title={takeOffLabel}
          onClick={onTakeOff}
          data-testid="loadout-slot-take-off"
          sx={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 24,
            height: 24,
            bgcolor: withAlpha(color.paper, 0.85),
            border: `1px solid ${color.rule}`,
            '&:hover': { bgcolor: color.paper3 },
          }}
        >
          <XIcon size={12} />
        </IconButton>
      )}
    </Box>
  );
}

interface InspectData {
  skin: OwnedSkin;
  owner: { steamId: string; name: string; avatar: string | null };
  /** Percent of drop options that are this rarity, and this exact skin. */
  odds?: { rarity: number; skin: number; skins: number } | null;
}

/**
 * One skin up close (board 2): the picture, wear next to the weapon, float
 * and pattern, where it was won, and who owns it.
 */
export function InspectSkinDialog({
  skinId,
  onClose,
}: {
  skinId: number | null;
  onClose: () => void;
}) {
  const { t, i18n } = useModuleTranslation('cs2');
  const [data, setData] = useState<InspectData | null>(null);

  useEffect(() => {
    if (skinId === null) return;
    let cancelled = false;
    api
      .get<InspectData>(`/api/skins/skin/${skinId}`)
      .then((r) => !cancelled && setData(r))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [skinId]);

  const skin = data?.skin && data.skin.id === skinId ? data.skin : null;
  const date = skin
    ? new Intl.DateTimeFormat(i18n.language, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }).format(skin.createdAt * 1000)
    : '';

  return (
    <Dialog
      open={skinId !== null}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: radii.lg,
          bgcolor: color.paper2,
          backgroundImage: 'none',
          overflow: 'hidden',
        },
      }}
    >
      {skin && data && (
        <Box
          data-testid="skin-inspect"
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,1.2fr) minmax(0,1fr)' },
          }}
        >
          <Box
            sx={{
              bgcolor: color.paper3,
              display: 'grid',
              placeItems: 'center',
              p: 5,
              borderBottom: `4px solid ${rarityColor[skin.rarity]}`,
            }}
          >
            <Box
              component="img"
              src={skin.imageUrl}
              alt={`${skin.weaponName} ${skin.name}`}
              sx={{ width: '100%', maxHeight: 280, objectFit: 'contain' }}
            />
          </Box>
          <Box sx={{ p: 3.5, display: 'flex', flexDirection: 'column', gap: 2.25 }}>
            <Box
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
            >
              <Box
                component="span"
                sx={{
                  px: 1.25,
                  py: 0.5,
                  borderRadius: radii.pill,
                  bgcolor: withAlpha(rarityColor[skin.rarity], 0.14),
                  color: rarityColor[skin.rarity],
                  ...mono,
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                }}
              >
                {t(`skins.rarity.${skin.rarity}`)}
              </Box>
              <IconButton
                aria-label={t('common.close')}
                onClick={onClose}
                sx={{ border: `1px solid ${color.rule}` }}
              >
                <XIcon size={16} />
              </IconButton>
            </Box>
            <Box>
              <Typography sx={{ color: color.muted }}>
                {skin.weaponName} · {t(`skins.wear.${wearKey(skin.float)}`)}
              </Typography>
              <WearBar float={skin.float} pattern={skin.pattern} />
              <Typography sx={{ fontFamily: fontDisplay, fontSize: '2rem', fontWeight: 700 }}>
                {skin.name}
              </Typography>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 1 }}>
              {[
                ...(skin.stattrak !== null && skin.stattrak !== undefined
                  ? [[t('skins.stattrakKills'), String(skin.stattrak)]]
                  : []),
                ...(data.odds
                  ? [
                      [t('skins.drops.rarityOdds'), formatOdds(data.odds.rarity)],
                      [t('skins.drops.skinOdds'), formatOdds(data.odds.skin)],
                    ]
                  : []),
              ].map(([label, value]) => (
                <Box
                  key={label}
                  sx={{ p: '10px 12px', borderRadius: '12px', bgcolor: color.paper3 }}
                >
                  <Typography sx={{ fontSize: '0.75rem', color: color.muted }}>{label}</Typography>
                  <Typography sx={{ ...mono, fontWeight: 500 }}>{value}</Typography>
                </Box>
              ))}
            </Box>
            <Box
              sx={{
                display: 'flex',
                gap: 1.5,
                alignItems: 'center',
                p: 1.75,
                borderRadius: '14px',
                bgcolor: color.paper3,
              }}
            >
              {skin.source === 'tournament' && skin.place ? (
                <TrophyIcon size={22} color={color.medalGold} aria-hidden />
              ) : (
                <PlayCircleIcon size={22} color={color.accent} aria-hidden />
              )}
              <Box>
                <Typography
                  sx={{
                    fontWeight: 600,
                    color: skin.source === 'tournament' && skin.place ? color.medalGold : color.ink,
                  }}
                >
                  {skin.source === 'tournament'
                    ? skin.place
                      ? t('skins.place', { n: skin.place })
                      : t('skins.tournamentMatch')
                    : skin.source === 'level'
                      ? t('skins.levelUp')
                      : skin.source === 'tradeup'
                        ? t('skins.tradeUp.origin')
                        : skin.source === 'admin'
                          ? t('skins.givenByAdmin')
                          : t('skins.wonMatchmaking')}
                </Typography>
                <Typography sx={{ fontSize: '0.8125rem', color: color.ink2 }}>
                  {[skin.sourceLabel ? sourceLabel(skin.sourceLabel) : null, date]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  bgcolor: color.paper3,
                  backgroundImage: data.owner.avatar ? `url("${data.owner.avatar}")` : 'none',
                  backgroundSize: 'cover',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 600,
                }}
              >
                {!data.owner.avatar && data.owner.name.slice(0, 1)}
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography>{data.owner.name}</Typography>
                <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
                  {skin.equipped ? t('skins.equipped') : t('skins.inInventory')}
                </Typography>
              </Box>
              <Link
                component={RouterLink}
                to={playerInventoryPath(data.owner.steamId)}
                onClick={onClose}
                sx={{ fontSize: '0.875rem', color: color.ink2 }}
              >
                {t('skins.theirInventory', { name: data.owner.name })}
              </Link>
            </Box>
            <VirtualNotice compact />
          </Box>
        </Box>
      )}
    </Dialog>
  );
}

/** CS2's wear ranges, Factory New to Battle-Scarred, in the colours trading sites use (CSFloat). */
const WEAR_RANGES: Array<{
  key: 'fn' | 'mw' | 'ft' | 'ww' | 'bs';
  from: number;
  to: number;
  tone: string;
}> = [
  { key: 'fn', from: 0, to: 0.07, tone: '#3a7d2c' },
  { key: 'mw', from: 0.07, to: 0.15, tone: '#5a9f32' },
  { key: 'ft', from: 0.15, to: 0.38, tone: '#a5c23f' },
  { key: 'ww', from: 0.38, to: 0.45, tone: '#c46a62' },
  { key: 'bs', from: 0.45, to: 1, tone: '#d63c34' },
];

/**
 * The float bar, as CSFloat draws it: the five wear ranges in their real
 * widths with a handle at the skin's float, and under it the float to 12
 * places and the pattern (#seed).
 */
export function WearBar({
  float,
  pattern,
  height = 8,
}: {
  float: number;
  pattern?: number | null;
  height?: number;
}) {
  const { t } = useModuleTranslation('cs2');
  const at = Math.min(1, Math.max(0, float));
  return (
    <Box data-testid="wear-bar" sx={{ mt: 1, mb: 0.5 }}>
      <Box
        role="img"
        aria-label={`${t(`skins.wear.${wearKey(float)}`)} · ${float.toFixed(4)}`}
        sx={{ position: 'relative' }}
      >
        <Box sx={{ display: 'flex', height, borderRadius: radii.pill, overflow: 'hidden' }}>
          {WEAR_RANGES.map((r) => (
            <Box key={r.key} sx={{ width: `${(r.to - r.from) * 100}%`, bgcolor: r.tone }} />
          ))}
        </Box>
        <Box
          sx={{
            position: 'absolute',
            top: -3,
            left: `clamp(0px, calc(${at * 100}% - 3px), calc(100% - 6px))`,
            width: 6,
            height: height + 6,
            borderRadius: radii.pill,
            bgcolor: '#e8e8e8',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
          }}
        />
      </Box>
      <Typography
        component="div"
        sx={{ ...mono, mt: 0.75, fontSize: '0.8125rem', color: tokens.color.ink }}
        data-testid="wear-bar-float"
      >
        {float.toFixed(12)}
        {typeof pattern === 'number' && (
          <Box component="span" sx={{ color: tokens.color.muted }}>
            {' '}
            (#{pattern})
          </Box>
        )}
      </Typography>
    </Box>
  );
}
