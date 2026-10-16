/**
 * A video's comments, under its player on the watch page. Signed-in players
 * write, edit and delete their own; admins can delete any. Times like `0:23`
 * in a comment seek the video (commentText.ts).
 */

import { useEffect, useState } from 'react';
import { Box, Button, ButtonBase, InputBase, Stack, Typography } from '@mui/material';
import {
  api,
  apiErrorMessage,
  PlayerAvatar,
  SectionHead,
  textSize,
  tokens,
  useAuth,
  useModuleTranslation,
  useSnackbar,
  fmtDateTime,
} from '../../../module-sdk';
import { commentPieces } from './commentText';

interface VideoComment {
  id: number;
  playerId: string;
  playerName: string;
  avatarUrl: string | null;
  body: string;
  createdAt: number;
  editedAt: number | null;
}

const MAX = 1000;

export function Comments({
  video,
  duration,
  onSeek,
}: {
  /** The video's library key (`clip/185`…). */
  video: string;
  /** Its length in seconds, when known: later times are not links. */
  duration: number | null;
  onSeek: (seconds: number) => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const { playerSteamId, isAuthenticated: isAdmin } = useAuth();
  const { showError } = useSnackbar();
  const [loaded, setLoaded] = useState<{ video: string; comments: VideoComment[] } | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ comments: VideoComment[] }>(
        `/api/game/cs2/watch/comments?video=${encodeURIComponent(video)}`
      )
      .then((r) => !cancelled && setLoaded({ video, comments: r.comments }))
      .catch(() => !cancelled && setLoaded({ video, comments: [] }));
    return () => {
      cancelled = true;
    };
  }, [video]);
  const comments = loaded?.video === video ? loaded.comments : null;
  const setComments = (next: (list: VideoComment[]) => VideoComment[]) =>
    setLoaded((l) => (l && l.video === video ? { video, comments: next(l.comments) } : l));

  const post = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const r = await api.post<{ comment: VideoComment }>('/api/game/cs2/watch/comments', {
        video,
        body,
      });
      setComments((list) => [...list, r.comment]);
      setDraft('');
    } catch (error) {
      showError(apiErrorMessage(error, t('comments.failed')));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editing || !editing.body.trim()) return;
    try {
      const r = await api.put<{ comment: VideoComment }>(
        `/api/game/cs2/watch/comments/${editing.id}`,
        { body: editing.body.trim() }
      );
      setComments((list) => list.map((c) => (c.id === r.comment.id ? r.comment : c)));
      setEditing(null);
    } catch (error) {
      showError(apiErrorMessage(error, t('comments.failed')));
    }
  };

  const remove = async (id: number) => {
    try {
      await api.delete(`/api/game/cs2/watch/comments/${id}`);
      setComments((list) => list.filter((c) => c.id !== id));
    } catch (error) {
      showError(apiErrorMessage(error, t('comments.failed')));
    }
  };

  const when = (seconds: number) => fmtDateTime(seconds);

  const field = {
    width: '100%',
    px: 1.5,
    py: 1,
    borderRadius: 1,
    border: `1px solid ${tokens.color.rule}`,
    bgcolor: tokens.color.paper2,
    fontSize: textSize.sm,
  } as const;

  return (
    <Box component="section" aria-labelledby="watch-comments" data-testid="watch-comments">
      <SectionHead
        id="watch-comments"
        title={
          comments ? t('comments.title', { count: comments.length }) : t('comments.titlePlain')
        }
      />
      {playerSteamId ? (
        <Stack spacing={1} sx={{ mb: 3 }}>
          <InputBase
            multiline
            minRows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX))}
            placeholder={t('comments.placeholder')}
            inputProps={{ 'aria-label': t('comments.placeholder'), maxLength: MAX }}
            sx={field}
            data-testid="comment-input"
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              onClick={() => void post()}
              disabled={!draft.trim() || busy}
              data-testid="comment-post"
            >
              {t('comments.post')}
            </Button>
          </Box>
        </Stack>
      ) : (
        <Typography sx={{ fontSize: textSize.sm, color: tokens.color.muted, mb: 3 }}>
          {t('comments.signIn')}
        </Typography>
      )}

      {comments && comments.length === 0 && (
        <Typography sx={{ fontSize: textSize.sm, color: tokens.color.muted }}>
          {t('comments.none')}
        </Typography>
      )}
      <Stack spacing={2.5} component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {(comments ?? []).map((c) => {
          const own = c.playerId === playerSteamId;
          return (
            <Box
              component="li"
              key={c.id}
              sx={{ display: 'flex', gap: 1.5 }}
              data-testid={`comment-${c.id}`}
            >
              <PlayerAvatar id={c.playerId} name={c.playerName} avatarUrl={c.avatarUrl} size={36} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <Typography sx={{ fontWeight: 600, fontSize: textSize.sm }}>
                    {c.playerName}
                  </Typography>
                  <Typography sx={{ fontSize: textSize.xs, color: tokens.color.muted }}>
                    {when(c.createdAt)}
                    {c.editedAt ? ` · ${t('comments.edited')}` : ''}
                  </Typography>
                </Box>
                {editing?.id === c.id ? (
                  <Stack spacing={1} sx={{ mt: 0.5 }}>
                    <InputBase
                      multiline
                      value={editing.body}
                      onChange={(e) => setEditing({ id: c.id, body: e.target.value.slice(0, MAX) })}
                      inputProps={{ 'aria-label': t('comments.edit'), maxLength: MAX }}
                      sx={field}
                    />
                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                      <Button onClick={() => setEditing(null)}>{t('comments.cancel')}</Button>
                      <Button variant="contained" onClick={() => void save()}>
                        {t('comments.save')}
                      </Button>
                    </Box>
                  </Stack>
                ) : (
                  <Typography
                    component="p"
                    sx={{
                      fontSize: textSize.sm,
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      m: 0,
                    }}
                  >
                    {commentPieces(c.body, duration).map((p, i) =>
                      'at' in p ? (
                        <ButtonBase
                          key={i}
                          onClick={() => onSeek(p.at)}
                          sx={{
                            color: tokens.color.accent,
                            font: 'inherit',
                            verticalAlign: 'baseline',
                            '&:hover': { textDecoration: 'underline' },
                            '&:focus-visible': { outline: `2px solid ${tokens.color.accent}` },
                          }}
                          aria-label={t('comments.seek', { time: p.text })}
                          data-testid="comment-time"
                        >
                          {p.text}
                        </ButtonBase>
                      ) : (
                        <span key={i}>{p.text}</span>
                      )
                    )}
                  </Typography>
                )}
                {(own || isAdmin) && editing?.id !== c.id && (
                  <Box sx={{ display: 'flex', gap: 1.5, mt: 0.5 }}>
                    {own && (
                      <ButtonBase
                        onClick={() => setEditing({ id: c.id, body: c.body })}
                        sx={{ fontSize: textSize.xs, color: tokens.color.muted }}
                      >
                        {t('comments.edit')}
                      </ButtonBase>
                    )}
                    <ButtonBase
                      onClick={() => void remove(c.id)}
                      sx={{ fontSize: textSize.xs, color: tokens.color.muted }}
                      data-testid={`comment-delete-${c.id}`}
                    >
                      {t('comments.delete')}
                    </ButtonBase>
                  </Box>
                )}
              </Box>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
