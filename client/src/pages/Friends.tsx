/**
 * Friends (`/friends`), reached from the account menu and the Play page's
 * Friends card. Three tabs: your friends (playing, searching, online, then
 * offline), friend requests to and from you, and Add friend (find players
 * by name or Steam profile link). `/friends?tab=requests` opens a tab.
 */
import React from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Button, ButtonBase, CircularProgress, Container, IconButton, InputBase, Menu, MenuItem, Tab, Tabs, Typography } from '@mui/material';
import { DotsThreeIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { EmptyPanel, PageHead } from '../components/common/ui';
import { PlayerAvatar } from '../components/player/PlayerAvatar';
import { useAuth } from '../contexts/AuthContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { pageTitle } from '../utils/pageTitle';
import { playerProfilePath } from '../paths';
import { fontMono, radii, textSize, tokens } from '../theme/tokens';
import {
  acceptFriend,
  cancelFriendRequest,
  declineFriend,
  findPeople,
  friendRequest,
  inviteToParty,
  removeFriend,
  useSocial,
  type Found,
  type Friend,
} from '../components/social/socialStore';
import { useMatchmaking } from '../components/matchmaking/matchmakingStore';
import { useTimeAgo } from '../components/social/timeAgo';

const { color } = tokens;
type TabId = 'friends' | 'requests' | 'add';

export function StatusDot({ friend, ring = color.paper }: { friend: Pick<Friend, 'online' | 'activity'>; ring?: string }) {
  const fill = friend.activity?.kind === 'playing' ? color.accent : friend.online || friend.activity ? color.live : color.muted;
  return (
    <Box
      aria-hidden
      sx={{ position: 'absolute', right: -2, bottom: -2, width: 12, height: 12, borderRadius: '50%', bgcolor: fill, border: `2px solid ${ring}` }}
    />
  );
}

/** "In a match · Polar vs Fjord", "Searching · 2v2", "Online", "Last seen 2 h ago". */
export function useFriendStatus() {
  const { t } = useTranslation();
  const timeAgo = useTimeAgo();
  return (f: Friend) => {
    if (f.activity?.kind === 'playing') return t('social.status.playing', { match: f.activity.label });
    if (f.activity?.kind === 'searching') return t('social.status.searching', { mode: f.activity.mode });
    if (f.online) return t('social.status.online');
    return f.lastSeenAt ? t('social.status.lastSeen', { when: timeAgo(f.lastSeenAt) }) : t('social.status.offline');
  };
}

export function PersonRow({
  id,
  name,
  avatarUrl,
  meta,
  dot,
  children,
}: {
  id: string;
  name: string;
  avatarUrl: string | null;
  meta: React.ReactNode;
  dot?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1.5, borderTop: 1, borderColor: 'divider', minWidth: 0, '&:first-of-type': { borderTop: 0 } }}>
      <ButtonBase component={RouterLink} to={playerProfilePath(id)} sx={{ position: 'relative', borderRadius: '50%', flex: 'none' }} aria-label={name}>
        <PlayerAvatar id={id} name={name} avatarUrl={avatarUrl ?? undefined} size={40} />
        {dot}
      </ButtonBase>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography component={RouterLink} to={playerProfilePath(id)} sx={{ display: 'block', fontWeight: 600, color: color.ink, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </Typography>
        <Typography sx={{ fontSize: '0.75rem', color: color.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flex: 'none' }}>{children}</Box>
    </Box>
  );
}

const groupSx = { fontFamily: fontMono, fontSize: textSize.xs, letterSpacing: '0.08em', textTransform: 'uppercase', color: color.muted, mt: 2.5, mb: 0.5 } as const;

function Done({ children }: { children: React.ReactNode }) {
  return <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: color.live, whiteSpace: 'nowrap' }}>{children}</Typography>;
}

export default function Friends() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showError, showSnackbar } = useSnackbar();
  const { playerSteamId, impersonation } = useAuth();
  const social = useSocial(Boolean(playerSteamId) && !impersonation);
  const { me } = useMatchmaking();
  const status = useFriendStatus();
  const timeAgo = useTimeAgo();
  const [params, setParams] = useSearchParams();
  const tab: TabId = params.get('tab') === 'requests' ? 'requests' : params.get('tab') === 'add' ? 'add' : 'friends';
  const [query, setQuery] = React.useState('');
  const [found, setFound] = React.useState<Found[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<{ el: HTMLElement; friend: Friend } | null>(null);

  React.useEffect(() => {
    document.title = pageTitle(t('social.friends.title'));
  }, [t]);

  // Add friend: people you played with until you type, then a search.
  React.useEffect(() => {
    if (tab !== 'add' || !playerSteamId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      findPeople(query)
        .then((people) => !cancelled && setFound(people))
        .catch(() => !cancelled && setFound([]))
        .finally(() => !cancelled && setSearching(false));
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, query, playerSteamId, social.friends.length, social.sent.length, social.incoming.length]);

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) showSnackbar(done, 'success');
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const invitedIds = new Set((me?.party?.invited ?? []).map((p) => p.id));
  const partyIds = new Set(me?.party?.members ?? []);
  const inviteButton = (f: Friend) =>
    partyIds.has(f.id) ? (
      <Done>{t('social.friends.inParty')}</Done>
    ) : invitedIds.has(f.id) ? (
      <Done>{t('social.invite.invited')}</Done>
    ) : f.invite && f.invite !== true ? (
      <Typography sx={{ fontSize: '0.75rem', color: color.muted, whiteSpace: 'nowrap' }}>{t(`social.invite.cannot.${f.invite}`)}</Typography>
    ) : (
      <Button
        size="small"
        variant={f.online ? 'contained' : 'outlined'}
        disabled={busy === f.id}
        onClick={() => void run(f.id, () => inviteToParty(f.id), t('social.invite.sent', { name: f.name }))}
      >
        {t('social.friends.invite')}
      </Button>
    );

  const online = social.friends.filter((f) => f.online || f.activity);
  const offline = social.friends.filter((f) => !f.online && !f.activity);

  if (!playerSteamId) {
    return (
      <Box minHeight="100vh">
        <TopNavBar />
        <Container maxWidth="md" sx={{ py: { xs: 3, md: 6 } }}>
          <EmptyPanel title={t('social.friends.signIn')} description={t('social.friends.signInHint')} />
        </Container>
      </Box>
    );
  }

  return (
    <Box minHeight="100vh" data-testid="friends-page">
      <TopNavBar />
      <Container maxWidth="md" sx={{ py: { xs: 3, md: 6 } }}>
        <PageHead title={t('social.friends.title')} />
        <Tabs
          value={tab}
          onChange={(_, v: TabId) => setParams(v === 'friends' ? {} : { tab: v }, { replace: true })}
          sx={{ borderBottom: 1, borderColor: 'divider', mb: 1 }}
        >
          <Tab value="friends" data-testid="friends-tab-friends" label={<TabLabel label={t('social.friends.tabFriends')} count={social.friends.length} />} />
          <Tab value="requests" data-testid="friends-tab-requests" label={<TabLabel label={t('social.friends.tabRequests')} count={social.incoming.length} accent />} />
          <Tab value="add" data-testid="friends-tab-add" label={t('social.friends.tabAdd')} />
        </Tabs>

        {tab === 'friends' && (
          <Box data-testid="friends-list">
            {!social.ready ? (
              <Box sx={{ py: 6, display: 'grid', placeItems: 'center' }}>
                <CircularProgress size={28} />
              </Box>
            ) : social.friends.length === 0 ? (
              <EmptyPanel title={t('social.friends.none')} description={t('social.friends.noneHint')}>
                <Button variant="contained" onClick={() => setParams({ tab: 'add' })}>
                  {t('social.friends.tabAdd')}
                </Button>
              </EmptyPanel>
            ) : (
              <>
                {online.length > 0 && <Typography sx={groupSx}>{t('social.friends.online', { count: online.length })}</Typography>}
                {online.map((f) => (
                  <PersonRow key={f.id} {...f} meta={status(f)} dot={<StatusDot friend={f} />}>
                    {inviteButton(f)}
                    <IconButton size="small" aria-label={t('social.friends.more', { name: f.name })} onClick={(e) => setMenu({ el: e.currentTarget, friend: f })}>
                      <DotsThreeIcon size={18} />
                    </IconButton>
                  </PersonRow>
                ))}
                {offline.length > 0 && <Typography sx={groupSx}>{t('social.friends.offline', { count: offline.length })}</Typography>}
                {offline.map((f) => (
                  <PersonRow key={f.id} {...f} meta={status(f)} dot={<StatusDot friend={f} />}>
                    {inviteButton(f)}
                    <IconButton size="small" aria-label={t('social.friends.more', { name: f.name })} onClick={(e) => setMenu({ el: e.currentTarget, friend: f })}>
                      <DotsThreeIcon size={18} />
                    </IconButton>
                  </PersonRow>
                ))}
              </>
            )}
          </Box>
        )}

        {tab === 'requests' && (
          <Box data-testid="friends-requests">
            <Typography sx={groupSx}>{t('social.friends.incoming')}</Typography>
            {social.incoming.length === 0 && <Typography sx={{ color: color.muted, fontSize: '0.8125rem', py: 1 }}>{t('social.friends.noIncoming')}</Typography>}
            {social.incoming.map((p) => (
              <PersonRow key={p.id} {...p} meta={t('social.friends.askedAgo', { when: timeAgo(p.at) })}>
                <Button size="small" variant="contained" disabled={busy === p.id} onClick={() => void run(p.id, () => acceptFriend(p.id))} data-testid={`accept-${p.id}`}>
                  {t('social.notice.accept')}
                </Button>
                <Button size="small" variant="outlined" disabled={busy === p.id} onClick={() => void run(p.id, () => declineFriend(p.id))}>
                  {t('social.notice.ignore')}
                </Button>
              </PersonRow>
            ))}
            <Typography sx={groupSx}>{t('social.friends.sent')}</Typography>
            {social.sent.length === 0 && <Typography sx={{ color: color.muted, fontSize: '0.8125rem', py: 1 }}>{t('social.friends.noSent')}</Typography>}
            {social.sent.map((p) => (
              <PersonRow key={p.id} {...p} meta={t('social.friends.sentAgo', { when: timeAgo(p.at) })}>
                <Button size="small" variant="outlined" disabled={busy === p.id} onClick={() => void run(p.id, () => cancelFriendRequest(p.id))}>
                  {t('social.friends.cancelRequest')}
                </Button>
              </PersonRow>
            ))}
          </Box>
        )}

        {tab === 'add' && (
          <Box data-testid="friends-add">
            <Box
              component="label"
              sx={{ display: 'flex', alignItems: 'center', gap: 1, height: 44, px: 1.75, mt: 2, borderRadius: radii.pill, border: 1, borderColor: 'divider', color: color.muted, '&:focus-within': { borderColor: color.ink2 } }}
            >
              <MagnifyingGlassIcon size={16} />
              <InputBase
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('social.friends.searchPlaceholder')}
                inputProps={{ 'aria-label': t('social.friends.searchPlaceholder'), 'data-testid': 'friends-search' }}
                sx={{ flex: 1, color: color.ink }}
              />
              {searching && <CircularProgress size={16} />}
            </Box>
            <Typography sx={groupSx}>{query.trim() ? t('social.friends.results') : t('social.friends.playedWith')}</Typography>
            {found && found.length === 0 && !searching && (
              <Typography sx={{ color: color.muted, fontSize: '0.8125rem', py: 1 }}>
                {query.trim().length >= 2 ? t('social.friends.noResults') : query.trim() ? t('social.friends.typeMore') : t('social.friends.noRecent')}
              </Typography>
            )}
            {(found ?? []).map((p) => (
              <PersonRow key={p.id} {...p} meta={t('social.friends.matches', { count: p.matches })}>
                {p.relation === 'friend' ? (
                  <Done>{t('social.friends.alreadyFriends')}</Done>
                ) : p.relation === 'sent' ? (
                  <Done>{t('social.friends.requestSent')}</Done>
                ) : (
                  <Button
                    size="small"
                    variant="contained"
                    disabled={busy === p.id}
                    data-testid={`add-${p.id}`}
                    onClick={() => void run(p.id, () => (p.relation === 'incoming' ? acceptFriend(p.id) : friendRequest(p.id)))}
                  >
                    {p.relation === 'incoming' ? t('social.notice.accept') : t('social.friends.addFriend')}
                  </Button>
                )}
              </PersonRow>
            ))}
          </Box>
        )}
      </Container>

      <Menu anchorEl={menu?.el} open={Boolean(menu)} onClose={() => setMenu(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MenuItem
          onClick={() => {
            if (menu) navigate(playerProfilePath(menu.friend.id));
            setMenu(null);
          }}
        >
          {t('social.friends.viewProfile')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            const f = menu?.friend;
            setMenu(null);
            if (f) void run(f.id, () => removeFriend(f.id), t('social.friends.removed', { name: f.name }));
          }}
          sx={{ color: color.ban }}
        >
          {t('social.friends.remove')}
        </MenuItem>
      </Menu>
    </Box>
  );
}

function TabLabel({ label, count, accent }: { label: string; count: number; accent?: boolean }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.75 }}>
      {label}
      {count > 0 && (
        <Box component="span" sx={{ fontFamily: fontMono, fontSize: textSize.xs, fontWeight: 600, color: accent ? color.accent : color.muted }}>
          {count}
        </Box>
      )}
    </Box>
  );
}
