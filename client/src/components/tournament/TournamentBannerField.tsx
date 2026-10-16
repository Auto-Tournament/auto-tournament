import { useRef, useState } from 'react';
import { Box, Button, ButtonBase, Stack, Typography } from '@mui/material';
import { ImageIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { getMapDisplayName, getMapImageUrl } from '../../constants/maps';
import { tokens, radii } from '../../theme/tokens';

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * The tournament page's banner, in the admin's event page settings: a preview
 * at the page's shape, Upload and Remove. Saves at once; the page and this
 * preview pick the new image up from the tournament update that follows.
 */
export function TournamentBannerField({
  bannerUrl,
  bannerMap,
  maps,
}: {
  bannerUrl: string | null | undefined;
  /** The map picture picked instead of an upload (settings.bannerMap). */
  bannerMap?: string | null;
  /** The maps to pick from (the tournament's pool). */
  maps?: string[];
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string | null>(bannerMap ?? null);
  const pickMap = async (map: string | null) => {
    setError('');
    setPicked(map);
    try {
      await api.put('/api/tournament', { settings: { bannerMap: map } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  // What shows: the upload, else the picked map.
  const shown = bannerUrl || (picked ? getMapImageUrl(picked) : null);
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
          border: `1px ${shown ? 'solid' : 'dashed'} ${tokens.color.rule}`,
          bgcolor: tokens.color.paper3,
          backgroundImage: shown ? `url("${shown}")` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center 40%',
          display: 'grid',
          placeItems: 'center',
          color: tokens.color.muted,
        }}
      >
        {!shown && <ImageIcon size={32} aria-hidden />}
      </Box>
      <Stack direction="row" spacing={1} alignItems="center">
        <Button
          variant="outlined"
          size="small"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {bannerUrl
            ? t('tournament.eventPage.bannerReplace')
            : t('tournament.eventPage.bannerUpload')}
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
      {/* No upload: a map's picture instead (the pool's maps). */}
      {!bannerUrl && maps && maps.length > 0 && (
        <Box
          data-testid="tournament-banner-maps"
          sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
        >
          <Typography variant="body2" color="text.secondary">
            {t('tournament.eventPage.bannerMapLabel')}
          </Typography>
          <Box
            role="radiogroup"
            aria-label={t('tournament.eventPage.bannerMapLabel')}
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 7.5rem), 1fr))',
              gap: 1,
              maxWidth: 640,
            }}
          >
            {[null, ...maps].map((map) => {
              const on = picked === map;
              return (
                <ButtonBase
                  key={map ?? 'none'}
                  role="radio"
                  aria-checked={on}
                  onClick={() => void pickMap(map)}
                  data-testid={`tournament-banner-map-${map ?? 'none'}`}
                  sx={{
                    aspectRatio: '16 / 9',
                    borderRadius: radii.sm,
                    border: `2px solid ${on ? tokens.color.accent : 'transparent'}`,
                    bgcolor: tokens.color.paper3,
                    backgroundImage: map ? `url("${getMapImageUrl(map)}")` : 'none',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'flex-start',
                    p: 0.75,
                    color: tokens.color.ink,
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                    '&.Mui-focusVisible': {
                      outline: `2px solid ${tokens.color.focus}`,
                      outlineOffset: 2,
                    },
                  }}
                >
                  {map ? getMapDisplayName(map) : t('tournament.eventPage.bannerMapNone')}
                </ButtonBase>
              );
            })}
          </Box>
        </Box>
      )}
    </Stack>
  );
}
