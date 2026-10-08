/**
 * The music reels play: the install's own library (bring your own music; the
 * API's demos/music.ts). The admin adds tracks they have the rights to,
 * listens to them, picks which play (`highlights_music`: every track, none or
 * the picked ones) and removes them. Under it, tracks that fit reels to find
 * on Pixabay and add (the API's MUSIC_SUGGESTIONS).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { PauseIcon, PlayIcon, TrashIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import {
  api,
  ExternalLink,
  MUSIC_GAIN,
  PLAYER_VOLUME_DEFAULT,
  PLAYER_VOLUME_KEY,
  useModuleTranslation,
  type MusicTrack,
} from '../../../module-sdk';

interface Suggestion {
  title: string;
  artist: string;
  genre: string;
  page: string;
  contentId: boolean;
}

type Mode = 'all' | 'off' | 'pick';

function modeOf(value: string): Mode {
  const v = value.trim();
  if (!v || v === 'all') return 'all';
  if (v === 'off') return 'off';
  return 'pick';
}

function savedVolume(): number {
  try {
    const raw = window.localStorage.getItem(PLAYER_VOLUME_KEY);
    const v = Number(raw);
    return raw !== null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : PLAYER_VOLUME_DEFAULT;
  } catch {
    return PLAYER_VOLUME_DEFAULT;
  }
}

/** A file name as a title: "my-track_final.mp3" → "my track final". */
const titleOf = (name: string) =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();

export function HighlightMusicSetting({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const [all, setAll] = useState<MusicTrack[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const mode = modeOf(value);

  // The form for a new track.
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [genre, setGenre] = useState('');
  const [source, setSource] = useState('');
  const [contentId, setContentId] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api
      .get<{ all: MusicTrack[]; suggestions?: Suggestion[] }>('/api/game/cs2/music')
      .then((res) => {
        setAll(res.all);
        setSuggestions(res.suggestions ?? []);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    return () => audio.current?.pause();
  }, [load]);

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

  // A track about as loud as under a reel: MUSIC_GAIN of the player's volume
  // (a little more: alone, without the game's sound).
  const listen = (id: string) => {
    audio.current?.pause();
    if (playing === id) {
      setPlaying(null);
      return;
    }
    const a = new Audio(`/api/game/cs2/music/${encodeURIComponent(id)}/file`);
    a.volume = Math.min(1, savedVolume() * MUSIC_GAIN * 3);
    a.onended = () => setPlaying(null);
    audio.current = a;
    void a.play().catch(() => setPlaying(null));
    setPlaying(id);
  };

  const add = async () => {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const q = new URLSearchParams({
        title: title.trim() || titleOf(file.name),
        artist: artist.trim(),
        genre: genre.trim().toLowerCase().replace(/\s+/g, '-'),
        source: source.trim(),
        contentId: contentId ? '1' : '0',
      });
      const res = await fetch(`/api/game/cs2/music?${q}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? res.statusText);
      setFile(null);
      setTitle('');
      setArtist('');
      setSource('');
      setContentId(false);
      if (fileInput.current) fileInput.current.value = '';
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (playing === id) audio.current?.pause();
    await api.delete(`/api/game/cs2/music/${encodeURIComponent(id)}`).catch(() => undefined);
    setRemoving(null);
    if (mode === 'pick') setPicked(new Set([...picked].filter((x) => x !== id)));
    load();
  };

  const genres = [
    ...new Set([...all.map((x) => x.genre), ...suggestions.map((s) => s.genre)].filter(Boolean)),
  ].sort();

  return (
    <Box
      sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1.5, maxWidth: 640 }}
      data-testid="cs2-highlights-music"
    >
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
        inputProps={{ 'data-testid': 'cs2-highlights-music-mode' }}
      >
        <MenuItem value="all">{t('settings.highlights.music.all', { count: all.length })}</MenuItem>
        <MenuItem value="pick">{t('settings.highlights.music.pick')}</MenuItem>
        <MenuItem value="off">{t('settings.highlights.music.off')}</MenuItem>
      </TextField>
      <Typography variant="caption" color="text.secondary">
        {t('settings.highlights.music.byo')}
      </Typography>

      {all.length > 0 && (
        <Box
          component="ul"
          sx={{
            listStyle: 'none',
            p: 0,
            m: 0,
            maxHeight: 360,
            overflowY: 'auto',
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
          }}
          data-testid="cs2-music-library"
        >
          {all.map((x) => (
            <Box
              component="li"
              key={x.id}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, minWidth: 0 }}
            >
              {mode === 'pick' && (
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
              )}
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
                  {[x.artist, x.genre].filter(Boolean).join(' · ')}
                </Typography>
              </Box>
              {x.contentId && <Chip size="small" label={t('settings.highlights.music.contentId')} />}
              {removing === x.id ? (
                <>
                  <Button size="small" color="error" onClick={() => void remove(x.id)}>
                    {t('settings.highlights.music.removeConfirm')}
                  </Button>
                  <Button size="small" onClick={() => setRemoving(null)}>
                    {t('settings.highlights.music.keep')}
                  </Button>
                </>
              ) : (
                <IconButton
                  size="small"
                  onClick={() => setRemoving(x.id)}
                  aria-label={t('settings.highlights.music.remove', { title: x.title })}
                >
                  <TrashIcon size={16} />
                </IconButton>
              )}
            </Box>
          ))}
        </Box>
      )}

      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
          p: 1.5,
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
        }}
        data-testid="cs2-music-add"
      >
        <Typography variant="subtitle2">{t('settings.highlights.music.addTitle')}</Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button
            component="label"
            variant="outlined"
            size="small"
            startIcon={<UploadSimpleIcon size={16} />}
          >
            {t('settings.highlights.music.chooseFile')}
            <input
              ref={fileInput}
              hidden
              type="file"
              accept="audio/*"
              data-testid="cs2-music-file"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title) setTitle(titleOf(f.name));
              }}
            />
          </Button>
          <Typography variant="body2" color="text.secondary" noWrap sx={{ minWidth: 0, flex: 1 }}>
            {file?.name ?? t('settings.highlights.music.noFile')}
          </Typography>
        </Box>
        <Box
          sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25 }}
        >
          <TextField
            size="small"
            label={t('settings.highlights.music.trackTitle')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <TextField
            size="small"
            label={t('settings.highlights.music.artist')}
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
          />
          <TextField
            size="small"
            label={t('settings.highlights.music.genre')}
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            inputProps={{ list: 'cs2-music-genres' }}
          />
          <TextField
            size="small"
            label={t('settings.highlights.music.source')}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </Box>
        <datalist id="cs2-music-genres">
          {genres.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={contentId}
              onChange={(e) => setContentId(e.target.checked)}
            />
          }
          label={t('settings.highlights.music.contentIdLabel')}
        />
        {error && <Alert severity="error">{error}</Alert>}
        <Box>
          <Button
            type="submit"
            variant="contained"
            size="small"
            disabled={!file || busy}
            data-testid="cs2-music-upload"
          >
            {busy ? t('settings.highlights.music.adding') : t('settings.highlights.music.add')}
          </Button>
        </Box>
        <Typography variant="caption" color="text.secondary">
          {t('settings.highlights.music.rights')}
        </Typography>
      </Box>

      {suggestions.length > 0 && (
        <Box component="details" sx={{ '& summary': { cursor: 'pointer' } }}>
          <Typography component="summary" variant="body2">
            {t('settings.highlights.music.suggestions', { count: suggestions.length })}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ my: 1 }}>
            {t('settings.highlights.music.suggestionsHelp')}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5, maxHeight: 280, overflowY: 'auto' }}>
            {suggestions.map((s) => (
              <Box component="li" key={s.page} sx={{ fontSize: '0.8125rem', mb: 0.5 }}>
                <ExternalLink href={s.page}>{s.title}</ExternalLink>
                {` · ${s.artist}`}
                {s.contentId ? ` · ${t('settings.highlights.music.contentId')}` : ''}
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}
