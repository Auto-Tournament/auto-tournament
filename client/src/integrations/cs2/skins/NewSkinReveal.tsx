import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Box, Button, Dialog, IconButton, Typography } from '@mui/material';
import { XIcon } from '@phosphor-icons/react';
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
  setPinnedNotices,
} from '../../../module-sdk';
import { useChoiceText } from './PrizePick';
import {
  announceChange,
  onSkinPick,
  useMySkins,
  useSkinsEnabled,
  wearKey,
  type SkinChoice,
  type OwnedSkin,
} from './useSkins';
import { rarityColor } from './rarity';

const { color } = tokens;

/** Gives each skin toast its own snackbar key. */
let toastSeq = 0;

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
  onClose,
}: {
  choice: SkinChoice;
  choose: (choiceId: number, index: number) => Promise<void>;
  /** Later: the choice stays pinned in the bell. */
  onClose: () => void;
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
      onClose={onClose}
      PaperProps={{
        sx: {
          position: 'relative',
          borderRadius: radii.lg,
          bgcolor: color.paper,
          backgroundImage: 'none',
        },
      }}
    >
      <IconButton
        onClick={onClose}
        aria-label={t('skins.pickLater')}
        title={t('skins.pickLater')}
        data-testid="skin-choice-later"
        sx={{ position: 'absolute', top: 12, right: 12, color: color.ink2 }}
      >
        <XIcon size={18} />
      </IconButton>
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
                  borderRadius: radii.md,
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
  const { showError, showSnackbar, closeSnackbar } = useSnackbar();
  const { pathname } = useLocation();
  // A drop or a new skin is a toast in the corner, not a pop-up over the page (it covered the
  // match room and stacked with other pop-ups): the full view opens when the player asks. On
  // the inventory (a trade-up, a skin they just made) it opens at once.
  const [open, setOpen] = useState(false);
  // Hidden with ×: until the next page load (a pending pick only lives here, so it comes back).
  const [hidden, setHidden] = useState<string | null>(null);
  // A Pick somewhere else (the bell's pinned row, a page's row): that choice, opened.
  const [wanted, setWanted] = useState<number | null>(null);
  useEffect(
    () =>
      onSkinPick((id) => {
        setWanted(id);
        setOpen(true);
      }),
    []
  );
  // The bell pins every choice until it is picked (its badge counts them).
  const choiceIds = choices.map((c) => c.id).join(',');
  useEffect(() => {
    setPinnedNotices('cs2', choiceIds ? choiceIds.split(',') : []);
    return () => setPinnedNotices('cs2', []);
  }, [choiceIds]);
  const expanded = open || pathname.startsWith('/inventory');
  const skin = inventory.find((s) => s.id === unseen[0]) ?? null;
  const choice = choices.find((c) => c.id === wanted) ?? choices[0] ?? null;
  const key = choice ? `choice-${choice.id}` : skin ? `skin-${skin.id}` : null;
  // A choice first: the kept skin then shows here as new (the player is in it: opened).
  const keep = async (choiceId: number, index: number) => {
    await choose(choiceId, index);
    setOpen(true);
  };
  // The toast is one of the site's toasts (the same stack, newest on top, folding after
  // three), so "Waiting for the server" and the like never cover it.
  const toastKey = key && !expanded && hidden !== key ? `skin-toast-${key}` : null;
  useEffect(() => {
    if (!toastKey || !key) return;
    // Its own key each time: a toast closed and shown again at once (a re-render, React's
    // strict mode) is a new toast, not the old one stuck mid-exit.
    const snack = `${toastKey}-${(toastSeq += 1)}`;
    showSnackbar(
      <DropToast
        choice={choice}
        skin={choice ? null : skin}
        onOpen={() => {
          closeSnackbar(snack);
          setOpen(true);
        }}
        onHide={() => {
          closeSnackbar(snack);
          setHidden(key);
        }}
      />,
      'plain',
      { persist: true, key: snack }
    );
    return () => closeSnackbar(snack);
    // The key names the choice or skin: a new one is a new toast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toastKey]);
  if (!key || !expanded) return null;
  if (choice)
    return (
      <ChoiceReveal
        choice={choice}
        choose={keep}
        onClose={() => {
          setOpen(false);
          setWanted(null);
          // Not straight back as a toast: it waits in the bell.
          setHidden(key);
        }}
      />
    );
  if (!skin) return null;
  const tone = rarityColor[skin.rarity];

  const close = () => {
    void markSeen([skin.id]);
    // The next new skin is a toast again, not another pop-up.
    setOpen(false);
  };
  // A full loadout given at once is dozens of reveals: one click closes them all.
  const closeAll = () => {
    void markSeen(unseen);
    setOpen(false);
  };

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
          {/* Closing is the main button: a player who just wants it gone must not equip it
              by accident (2026-10-15: a prize went on when its winner meant OK). */}
          <Button
            variant="contained"
            onClick={close}
            data-testid="new-skin-done"
            sx={{ borderRadius: radii.pill, px: 4, py: 1.75, fontWeight: 600 }}
          >
            {t('skins.keep')}
          </Button>
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
              variant="outlined"
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
                px: 3,
                py: 1.5,
                // The side's own colour on the outline: CT blue, T orange; both sides plain.
                ...(skin.side === null && action.team !== 0
                  ? {
                      borderColor: action.team === 3 ? color.sideCt : color.sideT,
                      color: action.team === 3 ? color.sideCt : color.sideT,
                    }
                  : {}),
              }}
            >
              {action.label}
            </Button>
          ))}
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

/**
 * A drop or a new skin as a toast (top right under the navbar, with the other toasts and clear
 * of the chat button). Words only, no pictures: what came and why, tinted in the rarity (the
 * best one on offer for a pick). Pick / See it opens the full view; it does not block the page.
 */
function DropToast({
  choice,
  skin,
  onOpen,
  onHide,
}: {
  choice: SkinChoice | null;
  skin: OwnedSkin | null;
  onOpen: () => void;
  onHide: () => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const text = useChoiceText();
  const said = choice ? text(choice) : null;
  const tone = said?.tone ?? (skin ? rarityColor[skin.rarity] : null) ?? color.accent;
  const rarity = said?.rarity ?? skin?.rarity ?? 'common';
  const title = said?.title ?? `${skin?.weaponName ?? ''} | ${skin?.name ?? ''}`;
  const line = said?.line ?? t('skins.toastNew');
  return (
    <Box
      role="status"
      aria-live="polite"
      data-testid="skin-toast"
      data-rarity={rarity}
      sx={{
        // In the site's toast stack. As wide as its two lines, each on one line; full width on phones.
        width: { xs: '100%', sm: 'max-content' },
        maxWidth: '100%',
        boxSizing: 'border-box',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        alignItems: 'center',
        columnGap: 1.5,
        // The draft (canvas "Skin to pick", option A): 12 px round, 14 px left, 8 px right.
        pt: 1.5,
        pb: 1.5,
        pl: 1.75,
        pr: 1,
        borderRadius: '14px',
        bgcolor: color.paper2,
        // The only colour: a hairline in the rarity.
        border: `1px solid ${withAlpha(tone, 0.55)}`,
        boxShadow: `0 16px 40px ${withAlpha('#000000', 0.45)}`,
      }}
    >
      <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <Typography
          sx={{
            fontWeight: 600,
            lineHeight: 1.35,
            whiteSpace: { sm: 'nowrap' },
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </Typography>
        <Typography
          sx={{
            fontSize: '13px',
            lineHeight: 1.4,
            color: color.ink2,
            whiteSpace: { sm: 'nowrap' },
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {line}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Button
          variant="outlined"
          onClick={onOpen}
          data-testid="skin-toast-open"
          sx={{
            minHeight: 36,
            px: 2,
            borderRadius: radii.pill,
            border: `2px solid ${color.rule}`,
            color: color.ink,
            fontSize: '14px',
            fontWeight: 600,
            '&:hover': { border: `2px solid ${color.muted}`, bgcolor: 'transparent' },
          }}
        >
          {choice ? t('skins.toastChoose') : t('skins.toastSee')}
        </Button>
        <IconButton
          onClick={onHide}
          aria-label={t('skins.toastHide')}
          sx={{ width: 32, height: 32, color: color.ink }}
        >
          <XIcon size={16} />
        </IconButton>
      </Box>
    </Box>
  );
}
