/**
 * Which music reels play (the API's `highlights_music`): every track, none,
 * or the ones picked here. Each track can be heard before picking it, as loud
 * as it is under a reel: MUSIC_GAIN of the player's saved volume (the slider
 * here sets that same volume).
 */

import { useEffect, useRef, useState } from 'react';
import { Box, Checkbox, IconButton, MenuItem, Slider, TextField, Typography } from '@mui/material';
import { PauseIcon, PlayIcon, SpeakerHighIcon } from '@phosphor-icons/react';
import {
  api,
  MUSIC_GAIN,
  PLAYER_VOLUME_DEFAULT,
  PLAYER_VOLUME_KEY,
  useModuleTranslation,
  type MusicTrack,
} from '../../../module-sdk';

function savedVolume(): number {
  try {
    const raw = window.localStorage.getItem(PLAYER_VOLUME_KEY);
    const v = Number(raw);
    return raw !== null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : PLAYER_VOLUME_DEFAULT;
  } catch {
    return PLAYER_VOLUME_DEFAULT;
  }
}

type Mode = 'all' | 'off' | 'pick';

function modeOf(value: string): Mode {
  const v = value.trim();
  if (!v || v === 'all') return 'all';
  if (v === 'off') return 'off';
  return 'pick';
}

export function HighlightMusicSetting({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const [all, setAll] = useState<MusicTrack[]>([]);
  const mode = modeOf(value);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [volume, setVolume] = useState(savedVolume);

  const changeVolume = (v: number) => {
    setVolume(v);
    if (audio.current) audio.current.volume = v * MUSIC_GAIN;
    try {
      window.localStorage.setItem(PLAYER_VOLUME_KEY, String(v));
    } catch {
      // Storage blocked: the level holds for this visit only.
    }
  };

  useEffect(() => {
    api
      .get<{ all: MusicTrack[] }>('/api/game/cs2/music')
      .then((res) => setAll(res.all))
      .catch(() => undefined);
    return () => audio.current?.pause();
  }, []);

  const picked = new Set(
    mode === 'pick' ? value.split(',').filter(Boolean) : mode === 'all' ? all.map((x) => x.id) : []
  );

  const setPicked = (next: Set<string>) => {
    if (next.size === 0) onChange('off');
    else
      onChange(
        all
          .filter((x) => next.has(x.id))
          .map((x) => x.id)
          .join(',')
      );
  };

  const listen = (id: string) => {
    if (playing === id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const a = new Audio(`/api/game/cs2/music/${id}.mp3`);
    a.volume = volume * MUSIC_GAIN;
    a.onended = () => setPlaying(null);
    audio.current = a;
    void a.play().catch(() => setPlaying(null));
    setPlaying(id);
  };

  return (
    <Box sx={{ mt: 2 }} data-testid="cs2-highlights-music">
      <TextField
        select
        label={t('settings.highlights.music.label')}
        value={mode}
        onChange={(e) => {
          const next = e.target.value as Mode;
          if (next === 'all') onChange('');
          else if (next === 'off') onChange('off');
          else setPicked(new Set(all.map((x) => x.id)));
        }}
        size="small"
        sx={{ maxWidth: 320 }}
        fullWidth
        inputProps={{ 'data-testid': 'cs2-highlights-music-mode' }}
      >
        <MenuItem value="all">{t('settings.highlights.music.all', { count: all.length })}</MenuItem>
        <MenuItem value="pick">{t('settings.highlights.music.pick')}</MenuItem>
        <MenuItem value="off">{t('settings.highlights.music.off')}</MenuItem>
      </TextField>
      <Typography
        variant="caption"
        color="text.secondary"
        display="block"
        sx={{ mt: 1, maxWidth: 560 }}
      >
        {t('settings.highlights.music.helper')}
      </Typography>
      {mode === 'pick' && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1.5, maxWidth: 280 }}>
          <SpeakerHighIcon size={18} aria-hidden />
          <Slider
            size="small"
            min={0}
            max={1}
            step={0.02}
            value={volume}
            onChange={(_, v) => changeVolume(v as number)}
            aria-label={t('settings.highlights.music.volume')}
            data-testid="cs2-highlights-music-volume"
          />
        </Box>
      )}
      {mode === 'pick' && (
        <Box
          component="ul"
          sx={{
            listStyle: 'none',
            p: 0,
            m: 0,
            mt: 1,
            maxWidth: 560,
            maxHeight: 360,
            overflowY: 'auto',
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
          }}
        >
          {all.map((x) => (
            <Box
              component="li"
              key={x.id}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, minWidth: 0 }}
            >
              <Checkbox
                size="small"
                checked={picked.has(x.id)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(x.id);
                  else next.delete(x.id);
                  setPicked(next);
                }}
                inputProps={{ 'aria-label': x.title }}
              />
              <IconButton
                size="small"
                onClick={() => listen(x.id)}
                aria-label={t(
                  playing === x.id
                    ? 'settings.highlights.music.stop'
                    : 'settings.highlights.music.listen',
                  { title: x.title }
                )}
              >
                {playing === x.id ? (
                  <PauseIcon size={16} weight="fill" />
                ) : (
                  <PlayIcon size={16} weight="fill" />
                )}
              </IconButton>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" noWrap>
                  {x.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap display="block">
                  {x.artist}
                  {x.contentId ? ` · ${t('settings.highlights.music.contentId')}` : ''}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
