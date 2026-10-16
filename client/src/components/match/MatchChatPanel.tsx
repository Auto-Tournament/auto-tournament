/**
 * The match's chat in the match room (the drafts: the match chat lives on the
 * match page): both teams and the admins, a box to write in, and Call an admin.
 * It reads and writes the same `match:<slug>` channel as the chat dock.
 */
import { useEffect, useRef, useState, type FormEvent, type ChangeEvent } from 'react';
import { fmtTime } from '../../utils/time';
import { Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { callAdmin, loadMessages, sendMessage, useChat } from '../chat/chatStore';
import { systemLineText } from '../chat/systemLine';
import { tokens, radii, textSize } from '../../theme/tokens';
import { SectionTitle, panel } from '../tournament/ui/draftUi';

const { color } = tokens;

export function MatchChatPanel({ slug, myTeam }: { slug: string; myTeam?: string | null }) {
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
      sx={{ ...panel, flex: '1 1 300px' }}
    >
      <SectionTitle id="match-chat" title={t('liveMatch.chat')} />
      <Box
        ref={listRef}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
          maxHeight: 420,
          overflowY: 'auto',
        }}
        aria-live="polite"
      >
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
            <Box
              key={m.id}
              sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, fontSize: '0.875rem' }}
            >
              <Typography
                component="span"
                sx={{ fontWeight: 600, color: tone, fontSize: '0.875rem' }}
              >
                {m.senderKind === 'system' ? t('liveMatch.system') : m.senderName}{' '}
                <Box
                  component="span"
                  sx={{ fontWeight: 400, color: color.muted, fontSize: textSize.xs }}
                >
                  {fmtTime(m.createdAt)}
                </Box>
              </Typography>
              <Typography
                component="span"
                sx={{ color: color.ink2, fontSize: '0.875rem', overflowWrap: 'anywhere' }}
              >
                {m.senderKind === 'system' ? systemLineText(m.body, t) : m.body}
              </Typography>
            </Box>
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
            minWidth: 0,
            minHeight: 44,
            borderRadius: radii.sm,
            border: `1px solid ${color.rule}`,
            bgcolor: color.paper3,
            color: color.ink,
            px: 1.5,
            font: 'inherit',
            '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 1 },
          }}
        />
        <Button
          type="submit"
          variant="outlined"
          disabled={!draft.trim()}
          sx={{ minHeight: 44, borderRadius: radii.sm }}
        >
          {t('liveMatch.send')}
        </Button>
      </Box>
      <Button
        variant="outlined"
        disabled={called}
        onClick={async () => {
          await callAdmin(channel);
          setCalled(true);
        }}
        sx={{ minHeight: 44, borderRadius: radii.pill }}
      >
        {called ? t('liveMatch.adminCalled') : t('liveMatch.callAdmin')}
      </Button>
    </Box>
  );
}
