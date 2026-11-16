/**
 * The match's chat in the match room (the drafts: the match chat lives on the
 * match page): both teams and the admins, a box to write in, and Call an admin.
 * It reads and writes the same `match:<slug>` channel as the chat dock.
 */
import { useEffect, useRef, useState, type FormEvent, type ChangeEvent } from 'react';
import { fmtTime } from '../../utils/time';
import { Box, Button, IconButton, Typography } from '@mui/material';
import { XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { callAdmin, loadMessages, sendMessage, useChat } from '../chat/chatStore';
import { systemLineText } from '../chat/systemLine';
import { tokens, fontDisplay } from '../../theme/tokens';

const { color } = tokens;

export function MatchChatPanel({
  slug,
  myTeam,
  besideHeight,
  onHide,
}: {
  slug: string;
  myTeam?: string | null;
  /** Next to a wide stage: the stage's height, so the two stay level. */
  besideHeight?: string;
  onHide?: () => void;
}) {
  const { t } = useTranslation();
  const channel = `match:${slug}`;
  const state = useChat();
  const thread = state.threads[channel];
  const [draft, setDraft] = useState('');
  const [called, setCalled] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadMessages(channel);
  }, [channel]);
  const count = thread?.messages.length ?? 0;
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [count]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    await sendMessage(channel, body);
  };

  return (
    <Box
      component="aside"
      aria-labelledby="match-chat"
      data-testid="match-chat"
      sx={{
        flex: besideHeight === undefined ? '1 1 300px' : { xs: '1 1 100%', md: '0 0 402px' },
        minWidth: 0,
        height: besideHeight === undefined ? 'auto' : { xs: 420, md: besideHeight },
        maxHeight: besideHeight === undefined ? 720 : undefined,
        transition: 'height 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        borderRadius: `${tokens.radius.md}px`,
        bgcolor: color.paper2,
        border: `1px solid ${color.rule}`,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          py: 1.75,
          borderBottom: `1px solid ${color.rule}`,
        }}
      >
        <Typography
          id="match-chat"
          component="h2"
          sx={{ m: 0, fontFamily: fontDisplay, fontWeight: 700, fontSize: '1rem' }}
        >
          {t('liveMatch.chat')}
        </Typography>
        {onHide && (
          <IconButton
            onClick={onHide}
            aria-label={t('liveMatch.hideChat')}
            size="small"
            sx={{ color: color.ink2, width: 32, height: 32 }}
          >
            <XIcon size={18} aria-hidden />
          </IconButton>
        )}
      </Box>
      <Box
        ref={listRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          px: 2,
          py: 1.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
        }}
        aria-live="polite"
      >
        <Box sx={{ flex: 1 }} />
        {(thread?.messages ?? []).map((m) => {
          const tone =
            m.senderKind === 'system'
              ? color.muted
              : m.senderKind === 'admin'
                ? color.warning
                : m.senderTeam && myTeam && m.senderTeam === myTeam
                  ? color.accent
                  : color.ink2;
          return (
            <Typography
              key={m.id}
              title={fmtTime(m.createdAt)}
              sx={{
                fontSize: '0.875rem',
                lineHeight: 1.4,
                color: color.ink,
                overflowWrap: 'anywhere',
              }}
            >
              <Box component="span" sx={{ fontWeight: 600, color: tone }}>
                {m.senderKind === 'system' ? t('liveMatch.system') : m.senderName}
              </Box>{' '}
              {m.senderKind === 'system' ? systemLineText(m.body, t) : m.body}
            </Typography>
          );
        })}
        {thread && thread.messages.length === 0 && (
          <Typography sx={{ color: color.muted, fontSize: '0.875rem' }}>
            {t('liveMatch.noMessages')}
          </Typography>
        )}
        {thread?.error && (
          <Typography sx={{ color: color.muted, fontSize: '0.875rem' }}>
            {t('liveMatch.chatSignIn')}
          </Typography>
        )}
      </Box>
      <Box sx={{ p: 1.5, borderTop: `1px solid ${color.rule}`, display: 'grid', gap: 1 }}>
        <Box
          component="form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void send();
          }}
          sx={{ display: 'flex', gap: 1 }}
        >
          <Box
            component="input"
            type="text"
            value={draft}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
            aria-label={t('liveMatch.messageLabel')}
            placeholder={t('liveMatch.messageLabel')}
            sx={{
              flex: 1,
              // An input's minimum is its default text width; 0 lets the row fit a narrow side column.
              width: 0,
              minWidth: 0,
              height: 44,
              boxSizing: 'border-box',
              borderRadius: `${tokens.radius.pill}px`,
              border: `1px solid ${color.muted}`,
              bgcolor: color.paper,
              color: color.ink,
              px: 1.75,
              font: 'inherit',
              '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 1 },
            }}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={!draft.trim()}
            sx={{ height: 44, px: 2, borderRadius: `${tokens.radius.pill}px`, fontWeight: 600 }}
          >
            {t('liveMatch.send')}
          </Button>
        </Box>
        <Button
          variant="text"
          disabled={called}
          onClick={async () => {
            await callAdmin(channel);
            setCalled(true);
          }}
          sx={{ minHeight: 36, alignSelf: 'center', color: color.ink2 }}
        >
          {called ? t('liveMatch.adminCalled') : t('liveMatch.callAdmin')}
        </Button>
      </Box>
    </Box>
  );
}
