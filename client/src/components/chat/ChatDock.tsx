/**
 * Chat on every page (chatStore.ts): a button in the corner with the unread
 * count and a peek at a new message, and a panel with the viewer's chats
 * (their match, their team, their party). Docked on the right on a wide
 * screen, the whole screen on a phone. Renders nothing while the viewer has no
 * chat to open.
 *
 * In a match's chat the enemy writes in blue, an admin in gold with an ADMIN
 * mark, and the viewer in the accent colour; platform lines sit in the middle.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Button, ButtonBase, CircularProgress, IconButton, InputBase, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useMatchmaking } from '../matchmaking/matchmakingStore';
import { fontDisplay, radii, textSize, tokens } from '../../theme/tokens';
import {
  callAdmin,
  closeChat,
  dismissPeek,
  loadMessages,
  openChat,
  selectChat,
  sendMessage,
  useChat,
  type ChatChannel,
  type ChatMessage,
} from './chatStore';

const { color } = tokens;
const PANEL_WIDTH = 420;
const PEEK_MS = 8000;
const MAX_BODY = 500;

const enemy = color.info;
const admin = color.sideT;
const tint = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

function ChatIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h16v11H9l-5 4z" />
    </svg>
  );
}

function ShieldIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" />
    </svg>
  );
}

function clockOf(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function Avatar({ message }: { message: ChatMessage }) {
  const isAdmin = message.senderKind === 'admin';
  return (
    <Box
      aria-hidden
      sx={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        fontFamily: fontDisplay,
        fontWeight: 600,
        fontSize: textSize.sm,
        bgcolor: isAdmin ? tint(admin, 0.16) : color.paper3,
        color: isAdmin ? admin : color.ink,
      }}
    >
      {isAdmin ? <ShieldIcon /> : (message.senderName.trim()[0] ?? '?').toUpperCase()}
    </Box>
  );
}

function MessageLine({
  message,
  mine,
  isEnemy,
  teamName,
}: {
  message: ChatMessage;
  mine: boolean;
  isEnemy: boolean;
  teamName: string | null;
}) {
  const { t } = useTranslation();
  if (message.senderKind === 'system') {
    return (
      <Typography
        component="div"
        data-testid="chat-system-line"
        sx={{ alignSelf: 'center', fontSize: textSize.xs, color: color.muted, px: 1.5, py: 0.6, borderRadius: radii.pill, bgcolor: color.paper3, textAlign: 'center' }}
      >
        {message.body}
      </Typography>
    );
  }
  if (mine) {
    return (
      <Box data-testid="chat-message" data-mine="true" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
        <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>
          {t('chat.you')} · {clockOf(message.createdAt)}
        </Typography>
        <Box
          sx={{
            maxWidth: '85%',
            px: 1.5,
            py: 1.1,
            borderRadius: '14px 4px 14px 14px',
            bgcolor: tint(color.accent, 0.14),
            border: `1px solid ${color.accent}`,
            fontSize: textSize.md,
            overflowWrap: 'anywhere',
            whiteSpace: 'pre-wrap',
          }}
        >
          {message.body}
        </Box>
      </Box>
    );
  }
  const isAdmin = message.senderKind === 'admin';
  const nameColor = isAdmin ? admin : isEnemy ? enemy : color.ink;
  const bubble = isAdmin ? tint(admin, 0.16) : isEnemy ? tint(enemy, 0.14) : color.paper3;
  return (
    <Box data-testid="chat-message" data-kind={isAdmin ? 'admin' : isEnemy ? 'enemy' : 'friend'} sx={{ display: 'grid', gridTemplateColumns: '32px minmax(0, 1fr)', gap: 1.25 }}>
      <Avatar message={message} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', fontSize: textSize.sm, flexWrap: 'wrap' }}>
          <Box component="span" sx={{ fontWeight: 600, color: nameColor }}>
            {message.senderName}
          </Box>
          {isAdmin && (
            <Box component="span" sx={{ px: 0.9, borderRadius: radii.pill, bgcolor: tint(admin, 0.16), color: admin, fontSize: '0.6875rem', fontWeight: 600 }}>
              {t('chat.adminBadge')}
            </Box>
          )}
          <Box component="span" sx={{ color: color.muted }}>
            {teamName ? `${teamName} · ` : ''}
            {clockOf(message.createdAt)}
          </Box>
        </Box>
        <Box
          sx={{
            alignSelf: 'flex-start',
            maxWidth: '100%',
            px: 1.5,
            py: 1.1,
            borderRadius: '4px 14px 14px 14px',
            bgcolor: bubble,
            fontSize: textSize.md,
            overflowWrap: 'anywhere',
            whiteSpace: 'pre-wrap',
          }}
        >
          {message.body}
        </Box>
      </Box>
    </Box>
  );
}

function Tabs({ channels, active }: { channels: ChatChannel[]; active: string | null }) {
  const { t } = useTranslation();
  const label = (c: ChatChannel) => (c.kind === 'match' ? t('chat.tabMatch') : c.kind === 'team' ? t('chat.tabTeam') : t('chat.tabParty'));
  return (
    <Box role="tablist" aria-label={t('chat.tabsLabel')} sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
      {channels.map((c) => {
        const selected = c.channel === active;
        return (
          <ButtonBase
            key={c.channel}
            role="tab"
            aria-selected={selected}
            data-testid={`chat-tab-${c.kind}`}
            onClick={() => selectChat(c.channel)}
            sx={{
              px: 1.75,
              py: 1,
              borderRadius: radii.pill,
              border: selected ? 0 : `1px solid ${color.rule}`,
              bgcolor: selected ? color.ink : 'transparent',
              color: selected ? color.accentInk : color.ink2,
              fontWeight: selected ? 600 : 400,
              fontSize: textSize.md,
              gap: 0.75,
              '&:focus-visible': { outline: `2px solid ${color.accent}`, outlineOffset: 2 },
            }}
          >
            {label(c)}
            {c.unread > 0 && !selected && (
              <Box component="span" sx={{ minWidth: 18, height: 18, px: 0.5, borderRadius: radii.pill, bgcolor: color.accent, color: color.accentInk, fontSize: '0.6875rem', display: 'grid', placeItems: 'center' }}>
                {c.unread}
              </Box>
            )}
          </ButtonBase>
        );
      })}
    </Box>
  );
}

function Panel({ phone }: { phone: boolean }) {
  const { t } = useTranslation();
  const { showError, showSuccess } = useSnackbar();
  const { playerSteamId, impersonation } = useAuth();
  const { channels, threads, active } = useChat();
  const channel = channels.find((c) => c.channel === active) ?? null;
  const thread = active ? threads[active] : undefined;
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [calling, setCalling] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the newest message in view unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [thread?.messages.length, active]);

  useEffect(() => {
    stick.current = true;
    inputRef.current?.focus();
  }, [active]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeChat();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const myTeam = thread?.myTeam ?? channel?.myTeam ?? null;
  const readOnly = Boolean(impersonation);

  const subtitle =
    channel?.kind === 'match'
      ? myTeam
        ? t('chat.matchWho', { title: channel.title.replace(/^vs /, '') })
        : t('chat.matchWhoAdmin')
      : channel?.kind === 'team'
        ? t('chat.teamWho', { team: channel.title })
        : channel?.kind === 'party'
          ? t('chat.partyWho')
          : '';

  const placeholder =
    channel?.kind === 'match' ? t('chat.placeholderMatch') : channel?.kind === 'team' ? t('chat.placeholderTeam') : t('chat.placeholderParty');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!active || !draft.trim() || sending) return;
    setSending(true);
    stick.current = true;
    try {
      await sendMessage(active, draft);
      setDraft('');
    } catch (error) {
      showError((error as Error).message || t('chat.sendFailed'));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const call = async () => {
    if (!active) return;
    setCalling(true);
    try {
      await callAdmin(active);
      showSuccess(t('chat.adminCalled'));
    } catch (error) {
      showError((error as Error).message || t('chat.callFailed'));
    } finally {
      setCalling(false);
    }
  };

  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (el.scrollTop < 40 && active && thread?.more && !thread.loading) {
      const before = el.scrollHeight;
      void loadMessages(active, true).then(() => {
        // Keep the reader's place when the older page lands above.
        requestAnimationFrame(() => {
          if (logRef.current) logRef.current.scrollTop += logRef.current.scrollHeight - before;
        });
      });
    }
  };

  return (
    <Box
      component="aside"
      aria-labelledby="chat-title"
      data-testid="chat-panel"
      sx={(theme) => ({
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: phone ? '100vw' : PANEL_WIDTH,
        zIndex: theme.zIndex.drawer + 2,
        bgcolor: color.paper2,
        borderLeft: phone ? 0 : `1px solid ${color.rule}`,
        boxShadow: phone ? 'none' : `-12px 0 32px ${color.shadow}`,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      })}
    >
      <Box sx={{ px: 2.25, pt: 2, pb: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5, borderBottom: `1px solid ${color.rule}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Typography id="chat-title" component="h2" sx={{ m: 0, fontFamily: fontDisplay, fontSize: textSize.lg, fontWeight: 600, flex: 1 }}>
            {t('chat.title')}
          </Typography>
          <IconButton
            aria-label={t('chat.close')}
            data-testid="chat-close"
            onClick={closeChat}
            sx={{ width: 36, height: 36, borderRadius: '10px', border: `1px solid ${color.rule}`, color: color.ink2 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </IconButton>
        </Box>
        {channels.length > 0 && <Tabs channels={channels} active={active} />}
        {subtitle && <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>{subtitle}</Typography>}
      </Box>

      <Box
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label={channel ? t('chat.logLabel', { title: channel.title }) : t('chat.title')}
        data-testid="chat-log"
        onScroll={onScroll}
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2.25, py: 2, display: 'flex', flexDirection: 'column', gap: 1.75 }}
      >
        {!channel && (
          <Typography sx={{ color: color.muted, fontSize: textSize.md, m: 'auto', textAlign: 'center', maxWidth: 280 }}>{t('chat.none')}</Typography>
        )}
        {thread?.loading && thread.messages.length === 0 && <CircularProgress size={22} sx={{ m: 'auto' }} aria-label={t('chat.loading')} />}
        {thread?.error && thread.messages.length === 0 && (
          <Typography role="alert" sx={{ color: color.ban, fontSize: textSize.sm, m: 'auto', textAlign: 'center' }}>
            {thread.error}
          </Typography>
        )}
        {channel && thread && !thread.loading && !thread.error && thread.messages.length === 0 && (
          <Typography sx={{ color: color.muted, fontSize: textSize.md, m: 'auto', textAlign: 'center', maxWidth: 280 }}>{t('chat.empty')}</Typography>
        )}
        {thread?.messages.map((m) => {
          const mine = m.senderId !== null && m.senderId === playerSteamId && m.senderKind !== 'system';
          const isEnemy = channel?.kind === 'match' && m.senderKind === 'player' && m.senderTeam !== null && myTeam !== null && m.senderTeam !== myTeam;
          const teamName = channel?.kind === 'match' && isEnemy && channel.title.startsWith('vs ') ? channel.title.slice(3) : null;
          return <MessageLine key={m.id} message={m} mine={mine} isEnemy={isEnemy} teamName={teamName} />;
        })}
      </Box>

      {channel && (
        <Box
          component="form"
          onSubmit={submit}
          sx={{ px: 1.75, pt: 1.5, pb: phone ? 'max(14px, env(safe-area-inset-bottom))' : 1.75, borderTop: `1px solid ${color.rule}`, display: 'flex', flexDirection: 'column', gap: 1.25 }}
        >
          {readOnly ? (
            <Typography sx={{ fontSize: textSize.sm, color: color.muted }}>{t('chat.readOnlyImpersonating')}</Typography>
          ) : (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <InputBase
                inputRef={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_BODY))}
                placeholder={placeholder}
                inputProps={{ 'aria-label': placeholder, 'data-testid': 'chat-input', maxLength: MAX_BODY }}
                sx={{
                  flex: 1,
                  minWidth: 0,
                  px: 1.75,
                  py: 0.9,
                  borderRadius: radii.md,
                  border: `1px solid ${color.rule}`,
                  bgcolor: color.paper,
                  color: color.ink,
                  fontSize: textSize.md,
                  '&.Mui-focused': { borderColor: color.accent },
                }}
              />
              <IconButton
                type="submit"
                aria-label={t('chat.send')}
                data-testid="chat-send"
                disabled={sending || !draft.trim()}
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: radii.md,
                  bgcolor: color.accent,
                  color: color.accentInk,
                  '&:hover': { bgcolor: color.accent2 },
                  '&.Mui-disabled': { bgcolor: color.paper3, color: color.muted },
                }}
              >
                {sending ? (
                  <CircularProgress size={16} sx={{ color: 'inherit' }} />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                )}
              </IconButton>
            </Box>
          )}
          {channel.kind === 'match' && myTeam && !readOnly && (
            <Button
              type="button"
              onClick={call}
              disabled={calling}
              data-testid="chat-call-admin"
              startIcon={<ShieldIcon size={14} />}
              sx={{ alignSelf: 'flex-start', px: 0, py: 0.5, minWidth: 0, color: admin, fontSize: textSize.sm, fontWeight: 500, textTransform: 'none' }}
            >
              {t('chat.callAdmin')}
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
}

export function ChatDock() {
  const { t } = useTranslation();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const { playerSteamId, isAuthenticated: isAdmin } = useAuth();
  const { channels, open, peek } = useChat({ steamId: playerSteamId ?? null, isAdmin });
  const { me } = useMatchmaking();
  const unread = channels.reduce((n, c) => n + c.unread, 0);

  useEffect(() => {
    if (!peek) return undefined;
    const id = setTimeout(dismissPeek, PEEK_MS);
    return () => clearTimeout(id);
  }, [peek]);

  if (open) return <Panel phone={phone} />;
  if (channels.length === 0) return null;

  const peekChannel = peek ? channels.find((c) => c.channel === peek.channel) : null;
  const peekWhere = peekChannel
    ? peekChannel.kind === 'match'
      ? t('chat.peekMatch', { title: peekChannel.title.replace(/^vs /, '') })
      : peekChannel.kind === 'team'
        ? t('chat.peekTeam')
        : t('chat.peekParty')
    : '';
  const peekColor = peek?.senderKind === 'admin' ? admin : peekChannel?.kind === 'match' && peek?.senderTeam !== peekChannel.myTeam ? enemy : color.ink;

  return (
    <Box
      sx={(th) => ({
        position: 'fixed',
        right: phone ? 16 : 32,
        // Above matchmaking's queue bar while searching.
        bottom: (phone ? 16 : 32) + (me?.queue ? 56 : 0),
        zIndex: th.zIndex.snackbar - 2,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 1.75,
      })}
    >
      {peek && peekChannel && (
        <ButtonBase
          data-testid="chat-peek"
          onClick={() => openChat(peek.channel)}
          sx={{
            width: phone ? 'calc(100vw - 32px)' : 340,
            boxSizing: 'border-box',
            p: '14px 16px',
            borderRadius: '18px',
            bgcolor: color.paper2,
            border: `1px solid ${color.rule}`,
            boxShadow: `0 12px 32px ${color.shadow}`,
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr)',
            gap: 1.5,
            alignItems: 'start',
            textAlign: 'left',
            color: color.ink,
            '&:focus-visible': { outline: `2px solid ${color.accent}`, outlineOffset: 2 },
          }}
        >
          <Avatar message={peek} />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4, minWidth: 0 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', fontSize: textSize.sm }}>
              <Box component="span" sx={{ fontWeight: 600, color: peekColor }}>
                {peek.senderName}
              </Box>
              <Box component="span" sx={{ color: color.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {peekWhere}
              </Box>
            </Box>
            <Box component="span" sx={{ fontSize: textSize.md, color: color.ink2, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {peek.body}
            </Box>
          </Box>
        </ButtonBase>
      )}
      <ButtonBase
        data-testid="chat-button"
        aria-label={unread > 0 ? t('chat.buttonUnread', { count: unread }) : t('chat.title')}
        onClick={() => openChat()}
        sx={{
          height: 56,
          px: phone ? 0 : '22px',
          pl: phone ? 0 : '18px',
          width: phone ? 56 : 'auto',
          borderRadius: radii.pill,
          bgcolor: color.accent,
          color: color.accentInk,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1.25,
          fontWeight: 600,
          fontSize: textSize.md,
          boxShadow: `0 12px 32px ${color.shadow}`,
          position: 'relative',
          '&:hover': { bgcolor: color.accent2 },
          '&:focus-visible': { outline: `2px solid ${color.ink}`, outlineOffset: 2 },
        }}
      >
        <ChatIcon />
        {!phone && t('chat.title')}
        {unread > 0 && (
          <Box
            component="span"
            data-testid="chat-unread"
            sx={{
              minWidth: 22,
              height: 22,
              px: 0.75,
              boxSizing: 'border-box',
              borderRadius: radii.pill,
              bgcolor: color.accentInk,
              color: color.accent,
              display: 'grid',
              placeItems: 'center',
              fontSize: textSize.xs,
              ...(phone ? { position: 'absolute', top: -4, right: -4 } : {}),
            }}
          >
            {unread}
          </Box>
        )}
      </ButtonBase>
    </Box>
  );
}
