/**
 * "+ Invite" on the Play page: friends online first, then people you played
 * with lately, then anyone on the site by name. The party's join link (and a
 * code box to join someone else's) sits at the bottom.
 */
import React from 'react';
import { Box, Button, CircularProgress, InputBase, Popover, Typography } from '@mui/material';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { PlayerAvatar } from '../player/PlayerAvatar';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { fontMono, radii, textSize, tokens } from '../../theme/tokens';
import { findPeople, inviteToParty, useSocial, type Found, type Friend } from './socialStore';

const { color } = tokens;

const groupSx = { fontFamily: fontMono, fontSize: textSize.xs, letterSpacing: '0.08em', textTransform: 'uppercase', color: color.muted, mt: 1.75, mb: 0.25 } as const;

interface Props {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  /** Ids already in the party, and invited. */
  members: string[];
  invited: string[];
  /** The party's join link, or null before there is a party. */
  inviteLink: string | null;
  onMakeLink: () => void;
  onJoinCode: (code: string) => void;
  busy: boolean;
}

export function InvitePicker({ anchorEl, onClose, members, invited, inviteLink, onMakeLink, onJoinCode, busy }: Props) {
  const { t } = useTranslation();
  const { showError, showSnackbar } = useSnackbar();
  const social = useSocial(true);
  const [query, setQuery] = React.useState('');
  const [recent, setRecent] = React.useState<Found[]>([]);
  const [results, setResults] = React.useState<Found[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [sending, setSending] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const open = Boolean(anchorEl);

  React.useEffect(() => {
    if (!open) return;
    void findPeople('').then(setRecent).catch(() => setRecent([]));
  }, [open]);

  React.useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      findPeople(query)
        .then((r) => !cancelled && setResults(r))
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setSearching(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const invite = async (id: string, name: string) => {
    setSending(id);
    try {
      await inviteToParty(id);
      showSnackbar(t('social.invite.sent', { name }), 'success');
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setSending(null);
    }
  };

  const action = (p: { id: string; name: string; invite?: Found['invite'] }, primary: boolean, unavailable?: string) => {
    if (members.includes(p.id)) return <State>{t('social.friends.inParty')}</State>;
    if (invited.includes(p.id)) return <State ok>{t('social.invite.invited')}</State>;
    if (unavailable) return <State>{unavailable}</State>;
    if (p.invite && p.invite !== true) return <State>{t(`social.invite.cannot.${p.invite}`)}</State>;
    return (
      <Button size="small" variant={primary ? 'contained' : 'outlined'} disabled={sending === p.id} onClick={() => void invite(p.id, p.name)} data-testid={`invite-${p.id}`}>
        {t('social.friends.invite')}
      </Button>
    );
  };

  const onlineFriends = social.friends.filter((f) => f.online || f.activity);
  const friendIds = new Set(social.friends.map((f) => f.id));
  const row = (p: { id: string; name: string; avatarUrl: string | null }, meta: string, right: React.ReactNode, dot?: string) => (
    <Box key={p.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 0.875, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
      <Box sx={{ position: 'relative', flex: 'none' }}>
        <PlayerAvatar id={p.id} name={p.name} avatarUrl={p.avatarUrl ?? undefined} size={34} />
        {dot && <Box aria-hidden sx={{ position: 'absolute', right: -2, bottom: -2, width: 11, height: 11, borderRadius: '50%', bgcolor: dot, border: `2px solid ${color.paper2}` }} />}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</Typography>
        <Typography sx={{ fontSize: '0.75rem', color: color.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</Typography>
      </Box>
      {right}
    </Box>
  );
  const friendMeta = (f: Friend) =>
    f.activity?.kind === 'playing' ? t('social.status.playing', { match: f.activity.label }) : f.activity?.kind === 'searching' ? t('social.status.searching', { mode: f.activity.mode }) : t('social.status.online');

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: { mt: 1, width: 380, maxWidth: 'calc(100vw - 32px)', borderRadius: '18px', border: 1, borderColor: 'divider', overflow: 'hidden' }, 'data-testid': 'invite-picker' } as object }}
    >
      <Box sx={{ p: 1.75, maxHeight: 440, overflowY: 'auto' }}>
        <Box
          component="label"
          sx={{ display: 'flex', alignItems: 'center', gap: 1, height: 38, px: 1.5, borderRadius: radii.pill, border: 1, borderColor: 'divider', color: color.muted, '&:focus-within': { borderColor: color.ink2 } }}
        >
          <MagnifyingGlassIcon size={14} />
          <InputBase
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('social.invite.searchPlaceholder')}
            inputProps={{ 'aria-label': t('social.invite.searchPlaceholder'), 'data-testid': 'invite-search' }}
            sx={{ flex: 1, fontSize: '0.8125rem', color: color.ink }}
          />
          {searching && <CircularProgress size={14} />}
        </Box>

        {results ? (
          <>
            <Typography sx={groupSx}>{t('social.invite.onSite')}</Typography>
            {results.length === 0 && !searching && <Typography sx={{ fontSize: '0.8125rem', color: color.muted, py: 1 }}>{t('social.friends.noResults')}</Typography>}
            {results.map((p) => row(p, t('social.friends.matches', { count: p.matches }), action(p, friendIds.has(p.id))))}
          </>
        ) : (
          <>
            <Typography sx={groupSx}>{t('social.invite.friendsOnline')}</Typography>
            {onlineFriends.length === 0 && (
              <Typography sx={{ fontSize: '0.8125rem', color: color.muted, py: 1 }}>
                {social.friends.length === 0 ? t('social.invite.noFriends') : t('social.invite.nobodyOnline')}
              </Typography>
            )}
            {onlineFriends.map((f) =>
              row(
                f,
                friendMeta(f),
                action(f, true, f.activity?.kind === 'playing' ? t('social.invite.inMatch') : undefined),
                f.activity?.kind === 'playing' ? color.accent : color.live
              )
            )}
            {recent.length > 0 && (
              <>
                <Typography sx={groupSx}>{t('social.invite.recent')}</Typography>
                {recent.slice(0, 5).map((p) => row(p, t('social.invite.together', { count: p.matches }), action(p, false)))}
              </>
            )}
          </>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.75, py: 1.25, borderTop: 1, borderColor: 'divider', bgcolor: color.paper3 }}>
        {inviteLink ? (
          <>
            <Typography sx={{ fontSize: '0.75rem', color: color.muted, whiteSpace: 'nowrap' }}>{t('social.invite.orLink')}</Typography>
            <Typography data-testid="mm-invite-link" sx={{ flex: 1, minWidth: 0, fontFamily: fontMono, fontSize: '0.75rem', color: color.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {inviteLink.replace(/^https?:\/\//, '')}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                void navigator.clipboard
                  .writeText(inviteLink)
                  .then(() => showSnackbar(t('matchmaking.party.copied'), 'success'))
                  .catch(() => showError(t('social.invite.copyFailed')));
              }}
            >
              {t('social.invite.copy')}
            </Button>
          </>
        ) : (
          <Box
            component="form"
            onSubmit={(e: React.FormEvent) => {
              e.preventDefault();
              onJoinCode(code.trim());
            }}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}
          >
            <Button size="small" variant="outlined" disabled={busy} onClick={onMakeLink} data-testid="mm-create-party">
              {t('social.invite.makeLink')}
            </Button>
            <InputBase
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={t('matchmaking.party.code')}
              inputProps={{ maxLength: 16, 'data-testid': 'mm-join-code', 'aria-label': t('matchmaking.party.code') }}
              sx={{ flex: 1, minWidth: 0, px: 1.25, height: 32, borderRadius: radii.md, bgcolor: color.paper, border: `1px solid ${color.rule}`, fontSize: '0.75rem' }}
            />
            <Button size="small" type="submit" disabled={busy || code.trim().length < 6}>
              {t('matchmaking.party.join')}
            </Button>
          </Box>
        )}
      </Box>
    </Popover>
  );
}

function State({ children, ok }: { children: React.ReactNode; ok?: boolean }) {
  return <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: ok ? color.live : color.muted, whiteSpace: 'nowrap' }}>{children}</Typography>;
}
