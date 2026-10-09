/**
 * The music reels play: the install's own library (bring your own music; the
 * API's services/highlights/music.ts). The admin adds tracks they have the rights to,
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
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { ExternalLink } from '../common/ExternalLink';
import { MUSIC_GAIN, PLAYER_VOLUME_DEFAULT, PLAYER_VOLUME_KEY } from './HighlightPlayer';
import type { MusicTrack } from './HighlightPlayer';

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
  const { t } = useTranslation();
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
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api
      .get<{ all: MusicTrack[]; suggestions?: Suggestion[] }>('/api/highlights/music')
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

  // A track as loud as under a reel by default: MUSIC_GAIN of the player's volume.
  const listen = (id: string) => {
    audio.current?.pause();
    if (playing === id) {
      setPlaying(null);
      return;
    }
    const a = new Audio(`/api/highlights/music/${encodeURIComponent(id)}/file`);
    a.volume = Math.min(1, savedVolume() * MUSIC_GAIN);
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
      const res = await fetch(`/api/highlights/music?${q}`, {
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

  // Or from a link to the audio file: the server downloads it.
  const addLink = async () => {
    if (!link.trim()) return;
    setError('');
    setBusy(true);
    try {
      await api.post('/api/highlights/music/from-link', {
        url: link.trim(),
        title: title.trim(),
        artist: artist.trim(),
        genre: genre.trim().toLowerCase().replace(/\s+/g, '-'),
        source: source.trim(),
        contentId,
      });
      setLink('');
      setTitle('');
      setArtist('');
      setSource('');
      setContentId(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (playing === id) audio.current?.pause();
    await api.delete(`/api/highlights/music/${encodeURIComponent(id)}`).catch(() => undefined);
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
        label={t('highlightsPage.music.label')}
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
        <MenuItem value="all">{t('highlightsPage.music.all', { count: all.length })}</MenuItem>
        <MenuItem value="pick">{t('highlightsPage.music.pick')}</MenuItem>
        <MenuItem value="off">{t('highlightsPage.music.off')}</MenuItem>
      </TextField>
      <Typography variant="caption" color="text.secondary">
        {t('highlightsPage.music.byo')}
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
                    ? 'highlightsPage.music.stop'
                    : 'highlightsPage.music.listen',
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
              {x.contentId && (
                <Chip size="small" label={t('highlightsPage.music.contentId')} />
              )}
              {removing === x.id ? (
                <>
                  <Button size="small" color="error" onClick={() => void remove(x.id)}>
                    {t('highlightsPage.music.removeConfirm')}
                  </Button>
                  <Button size="small" onClick={() => setRemoving(null)}>
                    {t('highlightsPage.music.keep')}
                  </Button>
                </>
              ) : (
                <IconButton
                  size="small"
                  onClick={() => setRemoving(x.id)}
                  aria-label={t('highlightsPage.music.remove', { title: x.title })}
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
        <Typography variant="subtitle2">{t('highlightsPage.music.addTitle')}</Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button
            component="label"
            variant="outlined"
            size="small"
            startIcon={<UploadSimpleIcon size={16} />}
          >
            {t('highlightsPage.music.chooseFile')}
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
            {file?.name ?? t('highlightsPage.music.noFile')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label={t('highlightsPage.music.link')}
            placeholder="https://cdn.pixabay.com/download/audio/…mp3"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            sx={{ flex: 1, minWidth: 220 }}
            inputProps={{ 'data-testid': 'cs2-music-link' }}
          />
          <Button
            variant="outlined"
            size="small"
            disabled={!link.trim() || busy}
            onClick={() => void addLink()}
            data-testid="cs2-music-add-link"
          >
            {t('highlightsPage.music.addLink')}
          </Button>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25 }}>
          <TextField
            size="small"
            label={t('highlightsPage.music.trackTitle')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <TextField
            size="small"
            label={t('highlightsPage.music.artist')}
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
          />
          <TextField
            size="small"
            label={t('highlightsPage.music.genre')}
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            inputProps={{ list: 'cs2-music-genres' }}
          />
          <TextField
            size="small"
            label={t('highlightsPage.music.source')}
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
          label={t('highlightsPage.music.contentIdLabel')}
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
            {busy ? t('highlightsPage.music.adding') : t('highlightsPage.music.add')}
          </Button>
        </Box>
        <Typography variant="caption" color="text.secondary">
          {t('highlightsPage.music.rights')}
        </Typography>
      </Box>

      {suggestions.length > 0 && (
        <Box component="details" sx={{ '& summary': { cursor: 'pointer' } }}>
          <Typography component="summary" variant="body2">
            {t('highlightsPage.music.suggestions', { count: suggestions.length })}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ my: 1 }}>
            {t('highlightsPage.music.suggestionsHelp')}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5, maxHeight: 280, overflowY: 'auto' }}>
            {suggestions.map((s) => (
              <Box component="li" key={s.page} sx={{ fontSize: '0.8125rem', mb: 0.5 }}>
                <ExternalLink href={s.page}>{s.title}</ExternalLink>
                {` · ${s.artist}`}
                {s.contentId ? ` · ${t('highlightsPage.music.contentId')}` : ''}
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}
