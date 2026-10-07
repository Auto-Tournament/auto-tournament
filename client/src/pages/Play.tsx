/**
 * Matchmaking: find a match alone or with a party (the Play draft). Your
 * party on top, the modes as big cards, one Find button; your level and
 * recent games on the side. While searching, the page shows who is in the
 * queue for your mode instead. `/play?join=CODE` joins a party from an
 * invite link.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Container,
  LinearProgress,
  Typography,
} from '@mui/material';
import { PlayCircleIcon, PlusIcon, XIcon } from '@phosphor-icons/react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { Panel } from '../components/common/ui';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useAuth } from '../contexts/AuthContext';
import { pageTitle } from '../utils/pageTitle';
import {
  matchmakingAction,
  playersFor,
  teamSizeOf,
  secondsUntil,
  useMatchmaking,
} from '../components/matchmaking/matchmakingStore';
import { AdminQueuePanel } from '../components/matchmaking/AdminQueuePanel';
import { InvitePicker } from '../components/social/InvitePicker';
import { FriendsCard } from '../components/social/FriendsCard';
import { answerPartyInvite, cancelPartyInvite } from '../components/social/socialStore';
import { getMapData } from '../constants/maps';
import { paths, playLobbyPath } from '../paths';
import { fontDisplay, fontMono, radii, textSize, tokens, withAlpha } from '../theme/tokens';

const { color } = tokens;
const MAX_PARTY = 5;

/** The map behind each mode's card. */
const MODE_MAP: Record<string, string> = {
  '5v5': 'de_mirage',
  '2v2': 'de_inferno',
  '1v1': 'de_nuke',
};

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, '0')}`;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const sectionTitleSx = { m: 0, fontSize: textSize.md, fontWeight: 600, color: color.ink2 } as const;

interface Progress {
  level: number;
  intoLevel: number;
  forNext: number;
}
interface HistoryRow {
  matchSlug: string;
  map: string | null;
  own: number | null;
  other: number | null;
  result: 'win' | 'loss' | 'draw' | null;
}

/** Level, rating and recent games (the side column). */
function YouColumn({ playerId, rating }: { playerId: string; rating: { elo: number } | null }) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const id = encodeURIComponent(playerId);
    void fetch(`/api/matchmaking/players/${id}/progress`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<{ progress: Progress }>) : null))
      .then((b) => !cancelled && setProgress(b?.progress ?? null))
      .catch(() => undefined);
    void fetch(`/api/matchmaking/players/${id}/history?limit=5`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<{ matches: HistoryRow[] }>) : null))
      .then((b) => !cancelled && setHistory(b?.matches ?? []))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  const pct =
    progress && progress.forNext > 0
      ? Math.min(100, (progress.intoLevel / progress.forNext) * 100)
      : 0;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Panel
        component="section"
        aria-labelledby="mm-level"
        sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        <Typography id="mm-level" component="h2" sx={sectionTitleSx}>
          {t('matchmaking.play.level')}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.25 }}>
          <Typography
            sx={{ fontFamily: fontDisplay, fontSize: '2.5rem', fontWeight: 700, lineHeight: 1 }}
          >
            {progress?.level ?? 1}
          </Typography>
          {progress && (
            <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
              {t('matchmaking.play.xp', { into: progress.intoLevel, next: progress.forNext })}
            </Typography>
          )}
        </Box>
        <LinearProgress
          variant="determinate"
          value={pct}
          aria-label={t('matchmaking.play.level')}
          sx={{ height: 8, borderRadius: 4, bgcolor: color.rule }}
        />
        {rating && (
          <Typography data-testid="mm-rating" sx={{ fontSize: textSize.sm, color: color.ink2 }}>
            {t('matchmaking.play.ratingShort')}{' '}
            <Box component="span" sx={{ fontFamily: fontMono, color: color.ink }}>
              {rating.elo}
            </Box>
          </Typography>
        )}
      </Panel>
      <Panel
        component="section"
        aria-labelledby="mm-recent"
        sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.25 }}
      >
        <Typography id="mm-recent" component="h2" sx={{ ...sectionTitleSx, mb: 0.5 }}>
          {t('matchmaking.play.recent')}
        </Typography>
        {history && history.length === 0 && (
          <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
            {t('matchmaking.play.noRecent')}
          </Typography>
        )}
        {(history ?? []).map((m) => {
          const tone =
            m.result === 'win' ? color.pick : m.result === 'loss' ? color.ban : color.muted;
          return (
            <Box
              key={m.matchSlug}
              sx={{
                display: 'grid',
                gridTemplateColumns: '24px minmax(0, 1fr) auto',
                gap: 1.25,
                alignItems: 'center',
                fontSize: textSize.md,
              }}
            >
              <Box
                aria-label={t(`matchmaking.play.result.${m.result ?? 'draw'}`)}
                sx={{
                  width: 24,
                  height: 24,
                  borderRadius: '6px',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: textSize.xs,
                  fontWeight: 700,
                  color: tone,
                  bgcolor: color.paper3,
                }}
              >
                {t(`matchmaking.play.resultShort.${m.result ?? 'draw'}`)}
              </Box>
              <Box
                component="span"
                sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {m.map ? (getMapData(m.map)?.displayName ?? m.map) : '—'}
              </Box>
              <Box component="span" sx={{ fontFamily: fontMono, color: color.ink2 }}>
                {m.own ?? 0} – {m.other ?? 0}
              </Box>
            </Box>
          );
        })}
        <Box
          component={RouterLink}
          to={paths.playLeaderboard}
          data-testid="mm-leaderboard-link"
          sx={{ mt: 0.5, fontSize: textSize.md, color: color.ink2 }}
        >
          {t('matchmaking.leaderboard.title')}
        </Box>
      </Panel>
    </Box>
  );
}

function PersonChip({
  name,
  avatarUrl,
  you,
}: {
  name: string;
  avatarUrl: string | null;
  you?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        pl: 0.75,
        pr: 1.5,
        py: 0.75,
        borderRadius: radii.pill,
        bgcolor: color.paper3,
        minWidth: 0,
      }}
    >
      <Avatar
        src={avatarUrl ?? undefined}
        sx={{ width: 30, height: 30, fontSize: textSize.xs, bgcolor: color.rule }}
      >
        {name.trim()[0]?.toUpperCase()}
      </Avatar>
      <Box
        component="span"
        sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {you ? t('matchmaking.play.you') : name}
      </Box>
    </Box>
  );
}

export default function Play() {
  const { t } = useTranslation();
  const { available, me, skew } = useMatchmaking();
  const { playerSteamId, isAuthenticated: isAdmin } = useAuth();
  const { showError, showSnackbar } = useSnackbar();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [inviteAnchor, setInviteAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    document.title = pageTitle(t('matchmaking.play.title'));
  }, [t]);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) showSnackbar(done, 'success');
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // An invite link: join once, then drop the code from the address.
  const joined = useRef(false);
  const joinCode = params.get('join');
  useEffect(() => {
    if (!available || !joinCode || joined.current) return;
    joined.current = true;
    void run(
      () => matchmakingAction('POST', '/party/join', { code: joinCode }),
      t('matchmaking.party.joined')
    );
    params.delete('join');
    setParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, joinCode]);

  const searching = !!me?.queue;
  const now = useNow(searching);

  if (available === null) {
    return (
      <Box minHeight="100vh">
        <TopNavBar />
        <Box display="flex" justifyContent="center" py={10}>
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  const party = me?.party ?? null;
  const partyPeople = party?.people ?? [];
  const modes = me?.modes ?? ['5v5'];
  // The party's mode once there is one; else what the player picked; else the first.
  const mode =
    party?.mode && modes.includes(party.mode)
      ? party.mode
      : picked && modes.includes(picked)
        ? picked
        : modes[0];
  const isLeader = !party || party.leader === playerSteamId;
  const cooldown = me?.cooldownUntil ? secondsUntil(me.cooldownUntil, skew) : 0;
  const inviteLink = party ? `${window.location.origin}${paths.play}?join=${party.inviteCode}` : '';
  const counts = me?.queueCounts ?? {};
  const totalQueued = Object.values(counts).reduce((a, b) => a + b, 0);
  const people =
    party?.people ?? party?.members.map((id) => ({ id, name: id, avatarUrl: null })) ?? [];
  // The leader picks the party's mode (saved, so everyone in it sees it); a
  // party can't pick a mode it's too big for, and members only watch.
  const partySize = party?.members.length ?? 1;
  const modeOpen = (m: string) => m === mode || (isLeader && !searching && partySize <= teamSizeOf(m));
  const pickMode = (m: string) => {
    if (m === mode || busy) return;
    if (party) void run(() => matchmakingAction('PUT', '/party/mode', { mode: m }));
    else setPicked(m);
  };

  const invited = party?.invited ?? [];
  const invites = me?.invites ?? [];
  const notReady = me?.notReady ?? [];

  const queueMode = me?.queue?.mode ?? mode;
  const waited =
    searching && me?.queue ? Math.max(0, Math.floor(now / 1000 + skew - me.queue.queuedAt)) : 0;
  const need = playersFor(queueMode);
  const inQueue = Math.min(need, counts[queueMode] ?? party?.members.length ?? 1);

  return (
    <Box minHeight="100vh">
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
        {!available ? (
          <Panel sx={{ p: 3 }} data-testid="mm-unavailable">
            <Typography>{t('matchmaking.play.unavailable')}</Typography>
          </Panel>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gap: 3.5,
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 340px' },
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'space-between',
                  gap: 2,
                  flexWrap: 'wrap',
                }}
              >
                <Typography
                  component="h1"
                  sx={{
                    m: 0,
                    fontFamily: fontDisplay,
                    fontSize: { xs: '2rem', md: '2.5rem' },
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                  }}
                >
                  {t('matchmaking.play.title')}
                </Typography>
                <Typography
                  sx={{ fontSize: textSize.md, color: color.ink2 }}
                  data-testid="mm-queued-total"
                >
                  <Box component="span" sx={{ color: color.pick }} aria-hidden>
                    ●{' '}
                  </Box>
                  {t('matchmaking.play.inQueue', { count: totalQueued })}
                  {typeof me?.online === 'number' && (
                    <Box component="span" sx={{ color: color.muted }} data-testid="mm-online">
                      {' · '}
                      {t('matchmaking.play.online', { count: me.online })}
                    </Box>
                  )}
                </Typography>
              </Box>

              {searching ? (
                <Panel
                  role="status"
                  data-testid="mm-searching"
                  sx={{
                    p: { xs: 3, md: 5 },
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 3,
                    textAlign: 'center',
                  }}
                >
                  <Typography
                    sx={{
                      fontSize: textSize.sm,
                      color: color.accent,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}
                  >
                    {t(`matchmaking.play.modeTitle.${queueMode}`, { defaultValue: queueMode })} ·{' '}
                    {queueMode}
                  </Typography>
                  <Typography
                    component="h2"
                    sx={{
                      m: 0,
                      fontFamily: fontDisplay,
                      fontSize: { xs: '2rem', md: '3rem' },
                      fontWeight: 700,
                      letterSpacing: '-0.02em',
                    }}
                  >
                    {t('matchmaking.play.lookingTitle')}
                  </Typography>
                  <Typography sx={{ fontFamily: fontMono, fontSize: '2rem', color: color.ink2 }}>
                    {clock(waited)}
                  </Typography>
                  <Box
                    role="img"
                    aria-label={t('matchmaking.play.seats', { count: inQueue, total: need })}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${Math.min(need, 5)}, 44px)`,
                      gap: 1.25,
                      justifyContent: 'center',
                    }}
                  >
                    {Array.from({ length: need }, (_, i) => {
                      // Your party fills the first seats with its faces; the rest are anonymous.
                      const face = partyPeople[i];
                      return (
                        <Box
                          key={i}
                          title={face?.name}
                          sx={{
                            width: 44,
                            height: 44,
                            borderRadius: '50%',
                            boxSizing: 'border-box',
                            display: 'grid',
                            placeItems: 'center',
                            fontWeight: 600,
                            color: color.ink,
                            backgroundImage: face?.avatarUrl ? `url(${face.avatarUrl})` : undefined,
                            backgroundSize: 'cover',
                            ...(i < inQueue
                              ? {
                                  bgcolor: withAlpha(color.accent, 0.25),
                                  boxShadow: `0 0 0 2px ${color.paper2}, 0 0 0 4px ${color.accent}`,
                                }
                              : { border: `2px dashed ${color.rule}` }),
                          }}
                        >
                          {face && !face.avatarUrl
                            ? (face.name.trim()[0] ?? '?').toUpperCase()
                            : null}
                        </Box>
                      );
                    })}
                  </Box>
                  <Typography sx={{ fontSize: textSize.md, color: color.ink2 }}>
                    {t('matchmaking.play.seats', { count: inQueue, total: need })}
                    {typeof me?.waitSeconds?.[queueMode] === 'number' && (
                      <Box
                        component="span"
                        sx={{ color: color.muted }}
                        data-testid="mm-searching-wait"
                      >
                        {' · '}
                        {t('matchmaking.play.usuallyWait', {
                          count: Math.max(1, Math.round(me.waitSeconds[queueMode]! / 60)),
                        })}
                      </Box>
                    )}
                  </Typography>
                  {isLeader && (
                    <Button
                      variant="outlined"
                      disabled={busy}
                      onClick={() => void run(() => matchmakingAction('DELETE', '/queue'))}
                      data-testid="mm-stop"
                      sx={{ borderRadius: radii.pill, px: 3.5, py: 1.5 }}
                    >
                      {t('matchmaking.play.leaveQueue')}
                    </Button>
                  )}
                </Panel>
              ) : (
                <>
                  {invites.map((inv) => (
                    <Panel
                      key={inv.partyId}
                      data-testid="mm-incoming-invite"
                      sx={{ p: 1.75, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', borderColor: color.accent }}
                    >
                      <Avatar src={inv.from.avatarUrl ?? undefined} sx={{ width: 36, height: 36, bgcolor: color.rule }}>
                        {inv.from.name.trim()[0]?.toUpperCase()}
                      </Avatar>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: textSize.sm }}>
                          <Box component="b">{inv.from.name}</Box> {t('social.notice.partyInvite')}
                        </Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: color.muted }}>
                          {t('social.notice.partyDetail', { mode: inv.mode, size: inv.size })}
                        </Typography>
                      </Box>
                      <Button size="small" variant="contained" disabled={busy} onClick={() => void run(() => answerPartyInvite(inv.partyId, true))}>
                        {t('social.notice.join')}
                      </Button>
                      <Button size="small" variant="outlined" disabled={busy} onClick={() => void run(() => answerPartyInvite(inv.partyId, false))}>
                        {t('social.notice.decline')}
                      </Button>
                    </Panel>
                  ))}
                  <Panel
                    component="section"
                    aria-labelledby="mm-party"
                    sx={{
                      p: 2.25,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      flexWrap: 'wrap',
                    }}
                  >
                    <Typography id="mm-party" component="h2" sx={sectionTitleSx}>
                      {t('matchmaking.play.partyTitle')}
                    </Typography>
                    <Box
                      sx={{ display: 'flex', gap: 1.25, flex: 1, flexWrap: 'wrap', minWidth: 0 }}
                    >
                      {party ? (
                        people.map((p) => (
                          <PersonChip
                            key={p.id}
                            name={p.name}
                            avatarUrl={p.avatarUrl}
                            you={p.id === playerSteamId}
                          />
                        ))
                      ) : (
                        <PersonChip name={t('matchmaking.play.you')} avatarUrl={null} you />
                      )}
                      {invited.map((p) => (
                        <Box
                          key={p.id}
                          data-testid={`mm-invited-${p.id}`}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.75,
                            pl: 0.5,
                            pr: 0.5,
                            py: 0.5,
                            borderRadius: radii.pill,
                            border: `1px dashed ${color.accent}`,
                            color: color.ink2,
                            fontSize: textSize.sm,
                          }}
                        >
                          <Avatar src={p.avatarUrl ?? undefined} sx={{ width: 28, height: 28, fontSize: textSize.xs, bgcolor: color.rule, opacity: 0.6 }}>
                            {p.name.trim()[0]?.toUpperCase()}
                          </Avatar>
                          {t('social.invite.chip', { name: p.name })}
                          <ButtonBase
                            aria-label={t('social.invite.cancel', { name: p.name })}
                            onClick={() => void run(() => cancelPartyInvite(p.id))}
                            sx={{ borderRadius: '50%', p: 0.5, color: color.muted }}
                          >
                            <XIcon size={12} />
                          </ButtonBase>
                        </Box>
                      ))}
                      {(!party || party.members.length + invited.length < MAX_PARTY) && (
                        <ButtonBase
                          onClick={(e) => setInviteAnchor(e.currentTarget)}
                          disabled={busy}
                          aria-haspopup="dialog"
                          aria-expanded={inviteAnchor ? 'true' : undefined}
                          data-testid="mm-invite"
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.75,
                            px: 1.75,
                            py: 0.75,
                            borderRadius: radii.pill,
                            border: `1px dashed ${color.rule}`,
                            color: color.ink2,
                          }}
                        >
                          <PlusIcon size={14} weight="bold" />
                          {t('matchmaking.play.invite')}
                        </ButtonBase>
                      )}
                      <InvitePicker
                        anchorEl={inviteAnchor}
                        onClose={() => setInviteAnchor(null)}
                        members={party?.members ?? (playerSteamId ? [playerSteamId] : [])}
                        invited={invited.map((p) => p.id)}
                        inviteLink={party ? inviteLink : null}
                        busy={busy}
                        onMakeLink={() => void run(() => matchmakingAction('POST', '/party', { mode }))}
                        onJoinCode={(c) => {
                          setInviteAnchor(null);
                          void run(() => matchmakingAction('POST', '/party/join', { code: c }), t('matchmaking.party.joined'));
                        }}
                      />
                    </Box>
                    <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
                      {t('matchmaking.play.partyOf', {
                        count: party?.members.length ?? 1,
                        max: MAX_PARTY,
                      })}
                    </Typography>
                    {party && (
                      <Box
                        sx={{
                          width: '100%',
                          display: 'flex',
                          gap: 1,
                          alignItems: 'center',
                          flexWrap: 'wrap',
                        }}
                      >
                        <Button
                          size="small"
                          color="inherit"
                          disabled={busy || me?.lobby?.status === 'accepting'}
                          onClick={() => void run(() => matchmakingAction('POST', '/party/leave'))}
                          data-testid="mm-leave"
                        >
                          {party.leader === playerSteamId
                            ? t('matchmaking.party.disband')
                            : t('matchmaking.party.leave')}
                        </Button>
                      </Box>
                    )}
                  </Panel>

                  <Box
                    role="radiogroup"
                    aria-label={t('matchmaking.play.mode')}
                    sx={{
                      display: 'grid',
                      gap: 2.5,
                      gridTemplateColumns: {
                        xs: 'minmax(0, 1fr)',
                        sm: `repeat(${Math.min(modes.length, 2)}, minmax(0, 1fr))`,
                      },
                    }}
                  >
                    {modes.map((m) => {
                      const selected = m === mode;
                      const image = getMapData(MODE_MAP[m] ?? 'de_mirage')?.image;
                      return (
                        <ButtonBase
                          key={m}
                          role="radio"
                          aria-checked={selected}
                          disabled={!modeOpen(m)}
                          onClick={() => pickMode(m)}
                          data-testid={`mm-mode-${m}`}
                          sx={{
                            height: { xs: 200, md: 280 },
                            borderRadius: '24px',
                            overflow: 'hidden',
                            display: 'flex',
                            alignItems: 'stretch',
                            textAlign: 'left',
                            backgroundImage: image ? `url(${image})` : undefined,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            bgcolor: color.paper3,
                            outline: selected ? `2px solid ${color.accent}` : 'none',
                            outlineOffset: 3,
                            '&:focus-visible': { outline: `2px solid ${color.focus}` },
                            '&.Mui-disabled': { opacity: 0.5 },
                          }}
                        >
                          <Box
                            sx={{
                              flex: 1,
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'flex-end',
                              gap: 0.75,
                              p: 2.75,
                              background: `linear-gradient(to top, ${color.paper} 25%, transparent)`,
                            }}
                          >
                            {selected && (
                              <Box
                                component="span"
                                sx={{
                                  alignSelf: 'flex-start',
                                  px: 1.25,
                                  py: 0.5,
                                  borderRadius: radii.pill,
                                  bgcolor: color.accent,
                                  color: color.accentInk,
                                  fontSize: textSize.xs,
                                  fontWeight: 600,
                                }}
                              >
                                {t('matchmaking.play.selected')}
                              </Box>
                            )}
                            <Typography
                              sx={{
                                fontFamily: fontDisplay,
                                fontSize: '1.875rem',
                                fontWeight: 700,
                                color: color.ink,
                              }}
                            >
                              {t(`matchmaking.play.modeTitle.${m}`, { defaultValue: m })}
                            </Typography>
                            <Typography
                              sx={{ fontSize: textSize.md, color: color.ink2 }}
                              data-testid={`mm-mode-rules-${m}`}
                            >
                              {me?.modeRules?.[m]
                                ? [
                                    t(`matchmaking.play.modeName.${m}`, { defaultValue: m }),
                                    `MR${me.modeRules[m].maxRounds}`,
                                    me.modeRules[m].pool ??
                                      t(`matchmaking.play.defaultPool.${m}`, { defaultValue: '' }),
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')
                                : t(`matchmaking.play.modeName.${m}`, { defaultValue: m })}
                            </Typography>
                            <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
                              {[
                                t('matchmaking.play.inQueue', { count: counts[m] ?? 0 }),
                                typeof me?.waitSeconds?.[m] === 'number'
                                  ? t('matchmaking.play.aboutWait', {
                                      count: Math.max(1, Math.round(me.waitSeconds[m]! / 60)),
                                    })
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </Typography>
                          </Box>
                        </ButtonBase>
                      );
                    })}
                  </Box>

                  {notReady.length > 0 && (
                    <Panel data-testid="mm-not-ready" sx={{ p: 2, borderColor: color.warning, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                      <Typography sx={{ fontWeight: 600, fontSize: textSize.sm }}>{t('social.setup.title')}</Typography>
                      {notReady.map((p) => (
                        <Typography key={p.id} sx={{ fontSize: textSize.sm, color: color.ink2 }}>
                          {p.id === playerSteamId
                            ? t(p.missing === 'game' ? 'social.setup.youGame' : 'social.setup.youAccount')
                            : t(p.missing === 'game' ? 'social.setup.theyGame' : 'social.setup.theyAccount', { name: p.name })}
                        </Typography>
                      ))}
                      {notReady.some((p) => p.id === playerSteamId) && (
                        <Button component={RouterLink} to={paths.meConnections} size="small" variant="outlined" sx={{ alignSelf: 'flex-start', mt: 0.5 }}>
                          {t('social.setup.fix')}
                        </Button>
                      )}
                    </Panel>
                  )}
                  {cooldown > 0 && (
                    <Typography color="warning.main" data-testid="mm-cooldown">
                      {t('matchmaking.play.cooldown', { minutes: Math.ceil(cooldown / 60) })}
                    </Typography>
                  )}
                  <Button
                    variant="contained"
                    disabled={
                      busy || !isLeader || cooldown > 0 || notReady.length > 0 || me?.lobby?.status === 'accepting'
                    }
                    onClick={() => void run(() => matchmakingAction('POST', '/queue', { mode }))}
                    data-testid="mm-find"
                    startIcon={<PlayCircleIcon size={26} />}
                    sx={{
                      height: 72,
                      borderRadius: radii.pill,
                      fontFamily: fontDisplay,
                      fontSize: '1.375rem',
                      fontWeight: 700,
                    }}
                  >
                    {t('matchmaking.play.find')}
                  </Button>
                  {!isLeader && (
                    <Typography color="text.secondary" sx={{ mt: -1.5 }}>
                      {t('matchmaking.play.leaderStarts')}
                    </Typography>
                  )}
                  {me?.lobby?.status === 'ready' && (
                    <Button
                      component={RouterLink}
                      to={playLobbyPath(me.lobby.id)}
                      variant="outlined"
                    >
                      {t('matchmaking.play.backToMatch')}
                    </Button>
                  )}
                </>
              )}
            </Box>
            {playerSteamId && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                <YouColumn playerId={playerSteamId} rating={me?.rating ?? null} />
                <FriendsCard members={party?.members ?? [playerSteamId]} invited={invited.map((p) => p.id)} />
              </Box>
            )}
            {isAdmin && (
              <Box sx={{ gridColumn: '1 / -1' }}>
                <AdminQueuePanel />
              </Box>
            )}
          </Box>
        )}
      </Container>
    </Box>
  );
}
