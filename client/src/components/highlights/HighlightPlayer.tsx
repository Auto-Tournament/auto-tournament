import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentRef,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { Box, ButtonBase, ListItemIcon, ListItemText, Menu, MenuItem, Slider } from '@mui/material';
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  CheckIcon,
  CornersInIcon,
  CornersOutIcon,
  DownloadSimpleIcon,
  MusicNotesIcon,
  PauseIcon,
  PlayIcon,
  ShareNetworkIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { mono, radii, tokens, withAlpha } from '../../theme/tokens';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { clock, type ClipMarkers } from './media';

const SPEEDS = [1, 0.5, 0.25] as const;
const SKIP = 5;
/** Controls fade this long after the pointer stops, while playing. */
const IDLE_MS = 2500;

/** A song the player can play under a reel (the API's /api/game/cs2/music). */
export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  page: string;
  seconds: number;
  /** Registered with YouTube Content ID: an upload with it can get a claim. */
  contentId: boolean;
}

/** Music beside a reel: the tracks to pick from and where its intro ends (0: none). */
export interface PlayerMusic {
  tracks: MusicTrack[];
  introEnd: number;
}

// The levels a download mixes the music at (the API's demos/music.ts).
export const MUSIC_GAIN = 0.11;
const MUSIC_INTRO_GAIN = 0.32;
const MUSIC_FADE_IN = 1.5;
const MUSIC_FADE_OUT = 2.5;

/** The music's volume `t` seconds into a video `length` long. */
export function musicGain(t: number, length: number, introEnd: number): number {
  let base = MUSIC_GAIN;
  if (introEnd > 0 && t < introEnd) base = MUSIC_INTRO_GAIN;
  else if (introEnd > 0 && t < introEnd + 0.8) base = MUSIC_INTRO_GAIN + (MUSIC_GAIN - MUSIC_INTRO_GAIN) * ((t - introEnd) / 0.8);
  const fadeIn = Math.min(1, Math.max(0, t / MUSIC_FADE_IN));
  const fadeOut = length > 0 ? Math.min(1, Math.max(0, (length - t) / MUSIC_FADE_OUT)) : 1;
  return base * fadeIn * fadeOut;
}

/**
 * Slowed down, the sound drops in pitch like tape (and like the reel's own
 * slow motion) instead of the browser keeping it at pitch.
 */
function tapeSpeed(el: { preservesPitch: boolean; playbackRate: number; webkitPreservesPitch?: boolean }, rate: number) {
  el.preservesPitch = false;
  el.webkitPreservesPitch = false;
  el.playbackRate = rate;
}

const LAST_TRACK = 'at.reelMusic.last';
/** The viewer's overall level, kept between visits (also the admin's music samples). */
export const PLAYER_VOLUME_KEY = 'at.player.volume';
/** The level until the viewer sets one. */
export const PLAYER_VOLUME_DEFAULT = 1;
const MUSIC_OFF = 'at.reelMusic.off';
const stored = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string | null) => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the pick just isn't remembered.
  }
};

/** A random song, never the one played last (unless it is the only one). */
function pickTrack(tracks: MusicTrack[]): MusicTrack | null {
  if (!tracks.length || stored(MUSIC_OFF) === '1') return null;
  const last = stored(LAST_TRACK);
  const pool = tracks.length > 1 ? tracks.filter((t) => t.id !== last) : tracks;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

export interface HighlightPlayerHandle {
  seek: (seconds: number) => void;
  play: () => void;
}

export interface HighlightPlayerProps {
  src: string;
  /** What it is, for screen readers ("d1Ledez · 4K with the M4A1-S"). */
  label: string;
  /** A clip's kills and slow motion, drawn on the scrubber. */
  markers?: ClipMarkers | null;
  /** A reel's chapter starts, drawn as gaps in the song. */
  chapterStarts?: number[];
  /** The file name a download is saved as. */
  downloadName?: string;
  /** The page to share (default: this one). */
  shareUrl?: string;
  /** Music to play beside the video, picked here and mixed in only on download. */
  music?: PlayerMusic | null;
  autoPlay?: boolean;
  onTime?: (seconds: number) => void;
}

const ctl = {
  width: 44,
  height: 44,
  borderRadius: '12px',
  color: '#f4edeb',
  '&:hover': { bgcolor: 'rgba(244,237,235,0.12)' },
  '&.Mui-focusVisible': { outline: `2px solid ${tokens.color.accent}`, outlineOffset: 2 },
} as const;

/**
 * Our own video player for highlights (the drafts' "video player" board):
 * a scrubber with each kill marked and the slow motion shaded, play, ±5 s,
 * mute, the time, speed (1×, 0.5×, 0.25×), share, download and full screen.
 * Space or K plays, J and L (or the arrows) skip, M mutes, F goes full screen.
 */
export const HighlightPlayer = forwardRef<HighlightPlayerHandle, HighlightPlayerProps>(function HighlightPlayer(
  { src, label, markers, chapterStarts = [], downloadName, shareUrl, music, autoPlay = false, onTime },
  ref
) {
  const { t } = useTranslation();
  const { showSuccess } = useSnackbar();
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<ComponentRef<'video'>>(null);
  const track = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(markers?.duration ?? 0);
  const [muted, setMuted] = useState(false);
  // The overall level: the game's sound and the music together.
  const [volume, setVolume] = useState(() => {
    const v = Number(stored(PLAYER_VOLUME_KEY));
    return stored(PLAYER_VOLUME_KEY) !== null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : PLAYER_VOLUME_DEFAULT;
  });
  const volumeRef = useRef(volume);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [full, setFull] = useState(false);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<number | undefined>(undefined);
  const audio = useRef<HTMLAudioElement>(null);
  const [song, setSong] = useState<MusicTrack | null>(null);
  const [musicMenu, setMusicMenu] = useState<HTMLElement | null>(null);
  const [downloadMenu, setDownloadMenu] = useState<HTMLElement | null>(null);
  const tracks = music?.tracks ?? [];
  const introEnd = music?.introEnd ?? 0;

  // A song for this video once the list arrives.
  const trackKey = tracks.map((t) => t.id).join(',');
  useEffect(() => {
    setSong(pickTrack(tracks));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- trackKey is tracks' identity
  }, [trackKey, src]);
  useEffect(() => {
    if (song) store(LAST_TRACK, song.id);
  }, [song]);

  const chooseTrack = (next: MusicTrack | null) => {
    store(MUSIC_OFF, next ? null : '1');
    setSong(next);
    setMusicMenu(null);
  };

  // The music follows the video: same place (looping when the video is
  // longer), playing and pausing with it, its level following musicGain.
  useEffect(() => {
    const v = video.current;
    const a = audio.current;
    if (!v || !a || !song) return;
    const at = () => (a.duration ? v.currentTime % a.duration : v.currentTime);
    const sync = () => {
      if (Number.isFinite(a.duration) || a.readyState > 0) a.currentTime = at();
    };
    const start = () => {
      sync();
      void a.play().catch(() => undefined);
    };
    const stop = () => a.pause();
    const rate = () => tapeSpeed(a, v.playbackRate);
    let frame = 0;
    const tick = () => {
      a.volume = Math.min(1, volumeRef.current * musicGain(v.currentTime, v.duration || 0, introEnd));
      if (!v.paused && a.readyState > 1 && Math.abs(a.currentTime - at()) > 0.25) sync();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    v.addEventListener('play', start);
    v.addEventListener('pause', stop);
    v.addEventListener('ended', stop);
    v.addEventListener('seeked', sync);
    v.addEventListener('ratechange', rate);
    a.addEventListener('loadedmetadata', sync);
    rate();
    if (!v.paused) start();
    return () => {
      cancelAnimationFrame(frame);
      v.removeEventListener('play', start);
      v.removeEventListener('pause', stop);
      v.removeEventListener('ended', stop);
      v.removeEventListener('seeked', sync);
      v.removeEventListener('ratechange', rate);
      a.removeEventListener('loadedmetadata', sync);
      a.pause();
    };
  }, [song, introEnd]);

  const play = useCallback(() => void video.current?.play().catch(() => undefined), []);
  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) play();
    else v.pause();
  }, [play]);
  const seek = useCallback((s: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(s, (v.duration || s) - 0.01));
    setTime(v.currentTime);
  }, []);
  useImperativeHandle(ref, () => ({ seek, play }), [seek, play]);

  // Controls hide while playing and the pointer rests; any movement brings them back.
  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(idleTimer.current), []);

  useEffect(() => {
    const onFull = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', onFull);
    return () => document.removeEventListener('fullscreenchange', onFull);
  }, []);

  useEffect(() => {
    if (video.current) tapeSpeed(video.current, speed);
  }, [speed]);

  useEffect(() => {
    volumeRef.current = volume;
    if (video.current) video.current.volume = volume;
    store(PLAYER_VOLUME_KEY, String(volume));
  }, [volume]);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen?.();
  };

  // The video file itself: pasted in Discord (or anywhere that unfurls
  // links) it plays as a video, no page in between.
  const share = async () => {
    const url = shareUrl ?? new URL(src, window.location.origin).href;
    try {
      if (navigator.share) {
        await navigator.share({ title: label, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      showSuccess(t('videoHighlights.player.linkCopied'));
    } catch {
      // Cancelled.
    }
  };

  // Scrubbing: press anywhere on the song and drag.
  const fromPointer = (e: PointerEvent) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || !duration) return;
    seek(((e.clientX - r.left) / r.width) * duration);
  };

  const onKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    const v = video.current;
    if (!v) return;
    if (k === ' ' || k === 'k') toggle();
    else if (k === 'j' || k === 'arrowleft') seek(v.currentTime - SKIP);
    else if (k === 'l' || k === 'arrowright') seek(v.currentTime + SKIP);
    else if (k === 'm') setMuted((m) => !m);
    else if (k === 'f') fullscreen();
    else if (k === 'n' && tracks.length > 1) chooseTrack(tracks[(tracks.findIndex((t) => t.id === song?.id) + 1) % tracks.length]!);
    else return;
    e.preventDefault();
    wake();
  };

  const pct = (s: number) => `${duration ? Math.min(100, (s / duration) * 100) : 0}%`;
  const kills = markers?.kills ?? [];
  const lastKill = kills.length ? kills[kills.length - 1] : null;
  const hidden = playing && idle;

  return (
    <Box
      ref={box}
      tabIndex={0}
      role="group"
      aria-label={label}
      onKeyDown={onKey}
      onPointerMove={wake}
      data-testid="highlight-player"
      sx={{
        position: 'relative',
        borderRadius: full ? 0 : '20px',
        overflow: 'hidden',
        aspectRatio: full ? undefined : '16 / 9',
        height: full ? '100%' : undefined,
        bgcolor: '#000',
        border: full ? 'none' : `1px solid ${tokens.color.rule}`,
        cursor: hidden ? 'none' : 'default',
        '&:focus-visible': { outline: `2px solid ${tokens.color.accent}`, outlineOffset: 2 },
      }}
    >
      <Box
        component="video"
        ref={video}
        src={src}
        playsInline
        autoPlay={autoPlay}
        muted={muted}
        preload="metadata"
        onClick={toggle}
        onPlay={() => {
          setPlaying(true);
          wake();
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || markers?.duration || 0)}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime);
          onTime?.(e.currentTarget.currentTime);
        }}
        sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
      {song && <audio ref={audio} src={`/api/game/cs2/music/${song.id}.mp3`} preload="auto" muted={muted} data-testid="highlight-music" />}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: 'linear-gradient(180deg, rgba(0,0,0,0) 62%, rgba(0,0,0,0.78) 100%)',
          opacity: hidden ? 0 : 1,
          transition: 'opacity 200ms',
        }}
      />

      {!playing && (
        <ButtonBase
          onClick={toggle}
          aria-label={t('videoHighlights.player.play')}
          sx={{
            position: 'absolute',
            left: '50%',
            top: '46%',
            width: { xs: 64, sm: 84 },
            height: { xs: 64, sm: 84 },
            transform: 'translate(-50%, -50%)',
            borderRadius: radii.pill,
            bgcolor: tokens.color.accent,
            color: tokens.color.accentInk,
            transition: 'transform 150ms',
            '&:hover': { transform: 'translate(-50%, -50%) scale(1.06)' },
            '&.Mui-focusVisible': { outline: `2px solid ${tokens.color.ink}`, outlineOffset: 3 },
          }}
        >
          <PlayIcon size={30} weight="fill" />
        </ButtonBase>
      )}

      <Box
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          px: { xs: 1, sm: 2 },
          pb: { xs: 0.5, sm: 1.5 },
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          opacity: hidden ? 0 : 1,
          transition: 'opacity 200ms',
        }}
      >
        <Box
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label={t('videoHighlights.player.seek')}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${clock(time)} / ${clock(duration)}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            fromPointer(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
          }}
          sx={{
            position: 'relative',
            height: 28,
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            touchAction: 'none',
            '&:focus-visible': { outline: `2px solid ${tokens.color.accent}`, outlineOffset: 2, borderRadius: 1 },
          }}
        >
          <Box sx={{ position: 'absolute', left: 0, right: 0, height: 5, borderRadius: 999, bgcolor: 'rgba(244,237,235,0.22)' }} />
          {markers?.slowmo && (
            <Box
              title={t('videoHighlights.player.slowmo')}
              sx={{
                position: 'absolute',
                left: pct(markers.slowmo[0]),
                width: `calc(${pct(markers.slowmo[1])} - ${pct(markers.slowmo[0])})`,
                height: 5,
                borderRadius: 999,
                bgcolor: withAlpha(tokens.color.accent, 0.38),
              }}
            />
          )}
          <Box sx={{ position: 'absolute', left: 0, width: pct(time), height: 5, borderRadius: 999, bgcolor: tokens.color.accent }} />
          {chapterStarts
            .filter((s) => s > 0)
            .map((s) => (
              <Box key={s} sx={{ position: 'absolute', left: pct(s), width: 3, ml: '-1.5px', height: 9, bgcolor: '#000' }} />
            ))}
          {kills.map((k, i) => {
            const last = k === lastKill && i === kills.length - 1;
            return (
              <Box
                key={`${k}-${i}`}
                title={t(last ? 'videoHighlights.player.lastKill' : 'videoHighlights.player.kill')}
                sx={{
                  position: 'absolute',
                  left: pct(k),
                  width: last ? 11 : 9,
                  height: last ? 11 : 9,
                  ml: last ? '-5.5px' : '-4.5px',
                  borderRadius: 999,
                  bgcolor: last ? tokens.color.accent : '#f4edeb',
                  border: '2px solid #000',
                  boxSizing: 'content-box',
                  pointerEvents: 'none',
                }}
              />
            );
          })}
          <Box
            sx={{
              position: 'absolute',
              left: pct(time),
              width: 16,
              height: 16,
              ml: '-8px',
              borderRadius: 999,
              bgcolor: '#f4edeb',
              boxShadow: `0 0 0 4px ${withAlpha(tokens.color.accent, 0.35)}`,
              pointerEvents: 'none',
            }}
          />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0, sm: 0.5 } }}>
          <ButtonBase onClick={toggle} aria-label={t(playing ? 'videoHighlights.player.pause' : 'videoHighlights.player.play')} sx={ctl}>
            {playing ? <PauseIcon size={22} weight="fill" /> : <PlayIcon size={22} weight="fill" />}
          </ButtonBase>
          <ButtonBase onClick={() => seek(time - SKIP)} aria-label={t('videoHighlights.player.back')} sx={{ ...ctl, display: { xs: 'none', sm: 'inline-flex' } }}>
            <ArrowCounterClockwiseIcon size={20} />
          </ButtonBase>
          <ButtonBase onClick={() => seek(time + SKIP)} aria-label={t('videoHighlights.player.forward')} sx={{ ...ctl, display: { xs: 'none', sm: 'inline-flex' } }}>
            <ArrowClockwiseIcon size={20} />
          </ButtonBase>
          <ButtonBase onClick={() => setMuted((m) => !m)} aria-label={t(muted ? 'videoHighlights.player.unmute' : 'videoHighlights.player.mute')} sx={ctl}>
            {muted || volume === 0 ? <SpeakerSlashIcon size={20} /> : <SpeakerHighIcon size={20} />}
          </ButtonBase>
          <Slider
            size="small"
            min={0}
            max={1}
            step={0.02}
            value={muted ? 0 : volume}
            onChange={(_, v) => {
              setVolume(v as number);
              if (muted && (v as number) > 0) setMuted(false);
            }}
            aria-label={t('videoHighlights.player.volume')}
            data-testid="highlight-volume"
            sx={{
              width: 72,
              mx: 1,
              color: '#f4edeb',
              display: { xs: 'none', sm: 'inline-flex' },
              '& .MuiSlider-thumb': { width: 12, height: 12 },
            }}
          />
          <Box component="span" sx={{ ...mono, fontSize: '0.8125rem', color: '#c4bcb9', ml: 0.75, whiteSpace: 'nowrap' }}>
            {clock(time)} / {clock(duration)}
          </Box>
          <Box sx={{ flex: 1 }} />
          <ButtonBase
            onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]!)}
            aria-label={t('videoHighlights.player.speed', { speed })}
            sx={{
              height: 32,
              px: 1.5,
              borderRadius: radii.pill,
              border: '1px solid rgba(244,237,235,0.3)',
              color: '#f4edeb',
              ...mono,
              fontSize: '0.8125rem',
              '&.Mui-focusVisible': { outline: `2px solid ${tokens.color.accent}`, outlineOffset: 2 },
            }}
          >
            {speed}×
          </ButtonBase>
          {tracks.length > 0 && (
            <ButtonBase
              onClick={(e) => setMusicMenu(e.currentTarget)}
              aria-label={song ? t('videoHighlights.player.musicOn', { title: song.title }) : t('videoHighlights.player.musicOff')}
              aria-haspopup="menu"
              data-testid="highlight-music-button"
              sx={{ ...ctl, opacity: song ? 1 : 0.55 }}
            >
              <MusicNotesIcon size={20} weight={song ? 'fill' : 'regular'} />
            </ButtonBase>
          )}
          <ButtonBase onClick={() => void share()} aria-label={t('videoHighlights.player.share')} sx={ctl}>
            <ShareNetworkIcon size={20} />
          </ButtonBase>
          {tracks.length > 0 ? (
            <ButtonBase
              onClick={(e) => setDownloadMenu(e.currentTarget)}
              aria-label={t('videoHighlights.player.download')}
              aria-haspopup="menu"
              data-testid="highlight-download-button"
              sx={{ ...ctl, display: { xs: 'none', sm: 'inline-flex' } }}
            >
              <DownloadSimpleIcon size={20} />
            </ButtonBase>
          ) : (
            <ButtonBase
              component="a"
              href={src}
              download={downloadName ?? ''}
              aria-label={t('videoHighlights.player.download')}
              sx={{ ...ctl, display: { xs: 'none', sm: 'inline-flex' } }}
            >
              <DownloadSimpleIcon size={20} />
            </ButtonBase>
          )}
          <ButtonBase onClick={fullscreen} aria-label={t(full ? 'videoHighlights.player.exitFullscreen' : 'videoHighlights.player.fullscreen')} sx={ctl}>
            {full ? <CornersInIcon size={20} /> : <CornersOutIcon size={20} />}
          </ButtonBase>
        </Box>
      </Box>

      <Menu
        anchorEl={musicMenu}
        open={!!musicMenu}
        onClose={() => setMusicMenu(null)}
        container={box.current}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        slotProps={{ paper: { sx: { maxHeight: 360, minWidth: 260, maxWidth: 360 } } }}
        data-testid="highlight-music-menu"
      >
        <MenuItem selected={!song} onClick={() => chooseTrack(null)}>
          <ListItemIcon>{!song && <CheckIcon size={16} />}</ListItemIcon>
          <ListItemText primary={t('videoHighlights.player.noMusic')} />
        </MenuItem>
        {tracks.map((tr) => (
          <MenuItem key={tr.id} selected={tr.id === song?.id} onClick={() => chooseTrack(tr)}>
            <ListItemIcon>{tr.id === song?.id && <CheckIcon size={16} />}</ListItemIcon>
            <ListItemText
              primary={tr.title}
              secondary={tr.artist}
              slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
            />
          </MenuItem>
        ))}
      </Menu>

      <Menu
        anchorEl={downloadMenu}
        open={!!downloadMenu}
        onClose={() => setDownloadMenu(null)}
        container={box.current}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        slotProps={{ paper: { sx: { maxWidth: 340 } } }}
        data-testid="highlight-download-menu"
      >
        <MenuItem component="a" href={src} download={downloadName ?? ''} onClick={() => setDownloadMenu(null)}>
          <ListItemText
            primary={t('videoHighlights.player.downloadWithout')}
            secondary={t('videoHighlights.player.downloadWithoutHint')}
            slotProps={{ secondary: { sx: { whiteSpace: 'normal' } } }}
          />
        </MenuItem>
        {song && (
          <MenuItem
            component="a"
            href={`${src}?music=${encodeURIComponent(song.id)}&intro=${introEnd.toFixed(1)}`}
            download={downloadName ?? ''}
            onClick={() => {
              setDownloadMenu(null);
              showSuccess(t('videoHighlights.player.downloadMixing'));
            }}
          >
            <ListItemText
              primary={t('videoHighlights.player.downloadWith', { title: song.title })}
              secondary={
                song.contentId ? t('videoHighlights.player.contentIdHint') : t('videoHighlights.player.musicCredit', { artist: song.artist })
              }
              slotProps={{ secondary: { sx: { whiteSpace: 'normal' } } }}
            />
          </MenuItem>
        )}
      </Menu>
    </Box>
  );
});
