import { useEffect, useState } from 'react';
import { Box, Button, Dialog, Typography } from '@mui/material';
import { sourceLabel, VirtualNotice, WearBar } from './SkinParts';
import {
  useModuleTranslation,
  useSnackbar,
  useSocket,
  tokens,
  fontDisplay,
  mono,
  radii,
  withAlpha,
} from '../../../module-sdk';
import { announceChange, useMySkins, useSkinsEnabled, wearKey, type SkinChoice } from './useSkins';
import { rarityColor } from './rarity';

const { color } = tokens;

/**
 * "New skin acquired" (board 3): shown once for each skin the player has not
 * seen yet, wherever they are in the app. The glow behind the skin breathes
 * slowly (still for reduced motion). Equip it (on T, CT or both) or keep it in the inventory.
 */
export function NewSkinReveal() {
  const enabled = useSkinsEnabled();
  const { available } = useMySkins();
  if (!enabled || !available) return null;
  return (
    <>
      <SkinsLive />
      <Reveal />
    </>
  );
}

/**
 * Listens for `skins:changed` in the player's own socket room, so a skin given
 * (a drop, a reward, an admin) shows the reveal at once, with no reload.
 */
function SkinsLive() {
  const socket = useSocket();
  useEffect(() => {
    // Rooms don't survive a reconnect: ask again on every connect, and read
    // again in case a skin came while disconnected.
    const onConnect = () => {
      socket.emit('player:subscribe');
      announceChange();
    };
    socket.on('connect', onConnect);
    socket.on('skins:changed', announceChange);
    return () => {
      socket.off('connect', onConnect);
      socket.off('skins:changed', announceChange);
    };
  }, [socket]);
  return null;
}

/** A drop's three options: the player keeps one (api: POST /api/skins/me/choices/:id). */
function ChoiceReveal({
  choice,
  choose,
}: {
  choice: SkinChoice;
  choose: (choiceId: number, index: number) => Promise<void>;
}) {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const [busy, setBusy] = useState<number | null>(null);
  const keep = (index: number) => {
    setBusy(index);
    choose(choice.id, index)
      .catch((error: unknown) =>
        showError(error instanceof Error ? error.message : t('skins.chooseFailed'))
      )
      .finally(() => setBusy(null));
  };
  return (
    <Dialog
      open
      maxWidth="md"
      fullWidth
      data-testid="skin-choice"
      PaperProps={{ sx: { borderRadius: radii.lg, bgcolor: color.paper, backgroundImage: 'none' } }}
    >
      <Box sx={{ p: { xs: 3, md: 5 }, display: 'grid', gap: 3, textAlign: 'center' }}>
        <Box>
          <Typography
            sx={{ ...mono, fontSize: '0.8125rem', color: color.muted, textTransform: 'uppercase' }}
          >
            {choice.sourceLabel ? sourceLabel(choice.sourceLabel) : t('skins.newDrop')}
          </Typography>
          <Typography
            sx={{
              fontFamily: fontDisplay,
              fontSize: { xs: '1.6rem', md: '2.2rem' },
              fontWeight: 700,
            }}
          >
            {t('skins.chooseTitle')}
          </Typography>
          <Typography sx={{ color: color.ink2 }}>{t('skins.chooseHelp')}</Typography>
        </Box>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
          {choice.options.map((o, index) => {
            const tone = rarityColor[o.rarity];
            return (
              <Box
                key={`${o.weapon}-${o.name}-${index}`}
                component="button"
                type="button"
                disabled={busy !== null}
                onClick={() => keep(index)}
                data-testid={`skin-choice-${index}`}
                sx={{
                  all: 'unset',
                  cursor: busy !== null ? 'default' : 'pointer',
                  display: 'grid',
                  gap: 1,
                  p: 2,
                  borderRadius: `${radii.md}px`,
                  border: `2px solid ${withAlpha(tone, 0.5)}`,
                  bgcolor: withAlpha(tone, 0.08),
                  opacity: busy !== null && busy !== index ? 0.5 : 1,
                  transition: 'transform 150ms, border-color 150ms',
                  '&:hover, &:focus-visible': { borderColor: tone, transform: 'translateY(-2px)' },
                }}
              >
                <Box
                  component="img"
                  src={o.image}
                  alt={`${o.weaponName} ${o.name}`}
                  sx={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'contain' }}
                />
                <Typography sx={{ fontWeight: 600 }}>
                  {o.stattrak && (
                    <Box component="span" sx={{ color: color.accent }}>
                      {t('skins.stattrak')}{' '}
                    </Box>
                  )}
                  {o.weaponName} | {o.name}
                </Typography>
                <Typography
                  sx={{ ...mono, fontSize: '0.8125rem', color: tone, textTransform: 'uppercase' }}
                >
                  {t(`skins.rarity.${o.rarity}`, { defaultValue: o.rarity })} ·{' '}
                  {t(`skins.wear.${wearKey(o.float)}`)}
                </Typography>
                <WearBar float={o.float} pattern={o.pattern} />
                <Typography sx={{ fontWeight: 600, color: tone }}>
                  {busy === index ? t('skins.keeping') : t('skins.keepThis')}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Dialog>
  );
}

function Reveal() {
  const { t } = useModuleTranslation('cs2');
  const { inventory, unseen, equipOn, markSeen, choices, choose } = useMySkins();
  const [equipping, setEquipping] = useState(false);
  const { showError } = useSnackbar();
  const skin = inventory.find((s) => s.id === unseen[0]) ?? null;
  // A choice first: the kept skin then shows here as new.
  if (choices.length > 0) return <ChoiceReveal choice={choices[0]!} choose={choose} />;
  if (!skin) return null;
  const tone = rarityColor[skin.rarity];

  const close = () => void markSeen([skin.id]);
  // A full loadout given at once is dozens of reveals: one click closes them all.
  const closeAll = () => void markSeen(unseen);

  return (
    <Dialog
      open
      onClose={close}
      maxWidth="md"
      fullWidth
      data-testid="new-skin-reveal"
      PaperProps={{ sx: { borderRadius: radii.lg, bgcolor: color.paper, backgroundImage: 'none' } }}
    >
      <Box
        sx={{
          p: { xs: 3, md: 6 },
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 3.5,
          textAlign: 'center',
        }}
      >
        <Box>
          <Typography
            sx={{ ...mono, fontSize: '0.8125rem', color: tone, textTransform: 'uppercase' }}
          >
            {t('skins.acquired')}
          </Typography>
          <Typography
            component="h2"
            sx={{
              fontFamily: fontDisplay,
              fontSize: { xs: '2rem', md: '3rem' },
              fontWeight: 700,
              letterSpacing: '-0.02em',
            }}
          >
            {skin.weaponName} · {skin.name}
          </Typography>
          {skin.sourceLabel && (
            <Typography sx={{ color: color.muted }}>{sourceLabel(skin.sourceLabel)}</Typography>
          )}
          {skin.source === 'matchmaking' && skin.sourceRef && <MatchPill slug={skin.sourceRef} />}
        </Box>
        <Box sx={{ width: '100%', maxWidth: 640 }}>
          <VirtualNotice compact />
        </Box>
        <Box
          sx={{
            width: '100%',
            maxWidth: 640,
            height: { xs: 220, md: 320 },
            borderRadius: '28px',
            bgcolor: color.paper2,
            border: `1px solid ${color.rule}`,
            borderBottom: `4px solid ${tone}`,
            display: 'grid',
            placeItems: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              width: { xs: 240, md: 360 },
              height: { xs: 240, md: 360 },
              borderRadius: '50%',
              bgcolor: withAlpha(tone, 0.16),
              animation: 'skinPulse 2.4s ease-in-out infinite',
              '@keyframes skinPulse': {
                '0%, 100%': { transform: 'scale(0.85)', opacity: 0.6 },
                '50%': { transform: 'scale(1.1)', opacity: 1 },
              },
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            }}
          />
          <Box
            component="img"
            src={skin.imageUrl}
            alt={`${skin.weaponName} ${skin.name}`}
            sx={{ position: 'relative', width: '75%', height: '75%', objectFit: 'contain' }}
          />
        </Box>
        <Box sx={{ width: '100%', maxWidth: 360 }}>
          <Typography sx={{ fontSize: '0.875rem', color: color.muted, textAlign: 'center' }}>
            {t(`skins.wear.${wearKey(skin.float)}`)}
          </Typography>
          <WearBar float={skin.float} pattern={skin.pattern} />
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', justifyContent: 'center' }}>
          {/* One-side weapons have one button; the rest pick T, CT or both. */}
          {(skin.side !== null
            ? [{ team: 0 as const, label: t('skins.equipNow'), testId: 'new-skin-equip' }]
            : [
                { team: 2 as const, label: t('skins.equipOnT'), testId: 'new-skin-equip-t' },
                { team: 3 as const, label: t('skins.equipOnCt'), testId: 'new-skin-equip-ct' },
                { team: 0 as const, label: t('skins.equipOnBoth'), testId: 'new-skin-equip' },
              ]
          ).map((action) => (
            <Button
              key={action.team}
              variant="contained"
              data-testid={action.testId}
              disabled={equipping}
              onClick={() => {
                setEquipping(true);
                equipOn(skin, action.team)
                  .then(close)
                  .catch((error: unknown) => {
                    showError(error instanceof Error ? error.message : t('skins.equipFailed'));
                  })
                  .finally(() => setEquipping(false));
              }}
              sx={{
                borderRadius: radii.pill,
                px: 4,
                py: 1.75,
                fontWeight: 600,
                // The side's own colour: CT blue, T orange; both sides plain.
                ...(skin.side === null && action.team !== 0
                  ? {
                      bgcolor: action.team === 3 ? color.sideCt : color.sideT,
                      color: '#111111',
                      '&:hover': {
                        bgcolor: action.team === 3 ? color.sideCt : color.sideT,
                        filter: 'brightness(1.1)',
                      },
                    }
                  : skin.side === null
                    ? {
                        bgcolor: color.ink,
                        color: color.paper,
                        '&:hover': { bgcolor: color.ink, filter: 'brightness(0.9)' },
                      }
                    : {}),
              }}
            >
              {action.label}
            </Button>
          ))}
          <Button
            variant="outlined"
            onClick={close}
            sx={{ borderRadius: radii.pill, px: 4, py: 1.75 }}
          >
            {t('skins.keep')}
          </Button>
          {unseen.length > 1 && (
            <Button
              variant="text"
              onClick={closeAll}
              data-testid="new-skin-keep-all"
              sx={{ borderRadius: radii.pill, px: 3, py: 1.75 }}
            >
              {t('skins.keepAll', { count: unseen.length })}
            </Button>
          )}
        </Box>
        <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
          {t('skins.notice')}
        </Typography>
      </Box>
    </Dialog>
  );
}

interface MatchSummary {
  myTeam?: number | null;
  maps: Array<{ map: string | null; team1: number; team2: number }>;
}

/** The game the drop came from, "Won 13 – 9 · de_mirage", from your side. */
function MatchPill({ slug }: { slug: string }) {
  const { t } = useModuleTranslation('cs2');
  const [result, setResult] = useState<MatchSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/matchmaking/matches/${encodeURIComponent(slug)}/result`, {
      credentials: 'same-origin',
    })
      .then((r) => (r.ok ? (r.json() as Promise<MatchSummary>) : null))
      .then((body) => {
        if (!cancelled) setResult(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug]);
  const mine = result?.myTeam ?? null;
  if (!result || mine === null || result.maps.length === 0) return null;
  const ours = (m: MatchSummary['maps'][number]) => (mine === 2 ? m.team2 : m.team1);
  const theirs = (m: MatchSummary['maps'][number]) => (mine === 2 ? m.team1 : m.team2);
  const won = result.maps.filter((m) => ours(m) > theirs(m)).length;
  const lost = result.maps.filter((m) => ours(m) < theirs(m)).length;
  const outcome = won > lost ? 'won' : won < lost ? 'lost' : 'drew';
  const score = result.maps.map((m) => `${ours(m)} – ${theirs(m)}`).join(', ');
  const maps = result.maps
    .map((m) => m.map)
    .filter(Boolean)
    .join(', ');
  return (
    <Box
      data-testid="new-skin-match"
      sx={{
        mt: 1.5,
        display: 'inline-flex',
        px: 1.75,
        py: 0.5,
        borderRadius: radii.pill,
        bgcolor: color.paper2,
        border: `1px solid ${color.rule}`,
        fontSize: '0.8125rem',
        color: outcome === 'won' ? color.pick : outcome === 'lost' ? color.ban : color.ink2,
      }}
    >
      {t(`skins.match.${outcome}`, { score })}
      {maps ? ` · ${maps}` : ''}
    </Box>
  );
}
