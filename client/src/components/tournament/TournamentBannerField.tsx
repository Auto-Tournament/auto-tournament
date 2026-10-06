import { useRef, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { ImageIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { tokens, radii } from '../../theme/tokens';

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * The tournament page's banner, in the admin's event page settings: a preview
 * at the page's shape, Upload and Remove. Saves at once; the page and this
 * preview pick the new image up from the tournament update that follows.
 */
export function TournamentBannerField({ bannerUrl }: { bannerUrl: string | null | undefined }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const upload = async (file: File) => {
    setError('');
    if (!TYPES.includes(file.type)) return setError(t('tournament.eventPage.bannerWrongType'));
    if (file.size > MAX_BYTES) return setError(t('tournament.eventPage.bannerTooLarge'));
    setBusy(true);
    try {
      const res = await fetch('/api/tournament/banner', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? res.statusText);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    setError('');
    setBusy(true);
    try {
      await api.delete('/api/tournament/banner');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={1.5} data-testid="tournament-banner-field">
      <Typography variant="subtitle2">{t('tournament.eventPage.bannerLabel')}</Typography>
      <Box
        sx={{
          aspectRatio: '16 / 5',
          maxWidth: 640,
          borderRadius: radii.md,
          border: `1px ${bannerUrl ? 'solid' : 'dashed'} ${tokens.color.rule}`,
          bgcolor: tokens.color.paper3,
          backgroundImage: bannerUrl ? `url("${bannerUrl}")` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center 40%',
          display: 'grid',
          placeItems: 'center',
          color: tokens.color.muted,
        }}
      >
        {!bannerUrl && <ImageIcon size={32} aria-hidden />}
      </Box>
      <Stack direction="row" spacing={1} alignItems="center">
        <Button variant="outlined" size="small" disabled={busy} onClick={() => input.current?.click()}>
          {bannerUrl ? t('tournament.eventPage.bannerReplace') : t('tournament.eventPage.bannerUpload')}
        </Button>
        {bannerUrl && (
          <Button size="small" color="error" disabled={busy} onClick={() => void remove()}>
            {t('tournament.eventPage.bannerRemove')}
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept={TYPES.join(',')}
          hidden
          data-testid="tournament-banner-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </Stack>
      <Typography variant="caption" color={error ? 'error' : 'text.secondary'}>
        {error || t('tournament.eventPage.bannerHelp')}
      </Typography>
    </Stack>
  );
}
