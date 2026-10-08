/**
 * Settings → News: send a notice to every player's bell (a new season, a
 * tournament announced, maintenance). A title, an optional line, and an
 * optional link (a page here, or https).
 */
import React from 'react';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { apiErrorMessage } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { SettingsCardHead } from './SettingsRow';

export function NewsSettingsCard() {
  const { t } = useTranslation();
  const { showError, showSnackbar } = useSnackbar();
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [confirm, setConfirm] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const urlOk = !url.trim() || /^(\/|https:\/\/)/.test(url.trim());

  const send = async () => {
    setSending(true);
    try {
      const res = await fetch('/api/social/news', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), url: url.trim() }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(apiErrorMessage(new Error(text), t('social.news.failed')));
      const { sent } = JSON.parse(text) as { sent: number };
      showSnackbar(t('social.news.sent', { count: sent }), 'success');
      setTitle('');
      setBody('');
      setUrl('');
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setSending(false);
      setConfirm(false);
    }
  };

  return (
    <Box>
      <SettingsCardHead title={t('social.news.title')} hint={t('social.news.hint')} />
      <Stack spacing={2} sx={{ mt: 2, maxWidth: 560 }}>
        <TextField id="news-title" label={t('social.news.titleLabel')} value={title} onChange={(e) => setTitle(e.target.value)} inputProps={{ maxLength: 140 }} size="small" />
        <TextField id="news-body" label={t('social.news.bodyLabel')} value={body} onChange={(e) => setBody(e.target.value)} inputProps={{ maxLength: 500 }} size="small" multiline minRows={2} />
        <TextField
          id="news-url"
          label={t('social.news.urlLabel')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          size="small"
          error={!urlOk}
          helperText={urlOk ? t('social.news.urlHint') : t('social.news.urlBad')}
        />
        {confirm ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '0.875rem' }}>{t('social.news.confirm')}</Typography>
            <Button variant="contained" disabled={sending} onClick={() => void send()}>
              {t('social.news.sendNow')}
            </Button>
            <Button disabled={sending} onClick={() => setConfirm(false)}>
              {t('social.news.cancel')}
            </Button>
          </Box>
        ) : (
          <Button variant="outlined" disabled={!title.trim() || !urlOk} onClick={() => setConfirm(true)} sx={{ alignSelf: 'flex-start' }}>
            {t('social.news.send')}
          </Button>
        )}
      </Stack>
    </Box>
  );
}
