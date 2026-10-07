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
import { Box, ButtonBase } from '@mui/material';
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  CornersInIcon,
  CornersOutIcon,
  DownloadSimpleIcon,
  PauseIcon,
  PlayIcon,
  ShareNetworkIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
} from '@phosphor-icons/react';
import { mono, radii, tokens, useModuleTranslation, useSnackbar, withAlpha } from '../../../module-sdk';
import { clock, type ClipMarkers } from './data';

const SPEEDS = [1, 0.5, 0.25] as const;
const SKIP = 5;
/** Controls fade this long after the pointer stops, while playing. */
const IDLE_MS = 2500;

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
  /** A reel's chapter starts, drawn as gaps in the track. */
  chapterStarts?: number[];
  /** The file name a download is saved as. */
  downloadName?: string;
  /** The page to share (default: this one). */
  shareUrl?: string;
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
  { src, label, markers, chapterStarts = [], downloadName, shareUrl, autoPlay = false, onTime },
  ref
) {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess } = useSnackbar();
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<ComponentRef<'video'>>(null);
  const track = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(markers?.duration ?? 0);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [full, setFull] = useState(false);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<number | undefined>(undefined);

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
    if (video.current) video.current.playbackRate = speed;
  }, [speed]);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen?.();
  };

  const share = async () => {
    const url = shareUrl ?? window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: label, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      showSuccess(t('highlights.player.linkCopied'));
    } catch {
      // Cancelled.
    }
  };

  // Scrubbing: press anywhere on the track and drag.
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
          aria-label={t('highlights.player.play')}
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
          aria-label={t('highlights.player.seek')}
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
              title={t('highlights.player.slowmo')}
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
                title={t(last ? 'highlights.player.lastKill' : 'highlights.player.kill')}
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
          <ButtonBase onClick={toggle} aria-label={t(playing ? 'highlights.player.pause' : 'highlights.player.play')} sx={ctl}>
            {playing ? <PauseIcon size={22} weight="fill" /> : <PlayIcon size={22} weight="fill" />}
          </ButtonBase>
          <ButtonBase onClick={() => seek(time - SKIP)} aria-label={t('highlights.player.back')} sx={{ ...ctl, display: { xs: 'none', sm: 'inline-flex' } }}>
            <ArrowCounterClockwiseIcon size={20} />
          </ButtonBase>
          <ButtonBase onClick={() => seek(time + SKIP)} aria-label={t('highlights.player.forward')} sx={{ ...ctl, display: { xs: 'none', sm: 'inline-flex' } }}>
            <ArrowClockwiseIcon size={20} />
          </ButtonBase>
          <ButtonBase onClick={() => setMuted((m) => !m)} aria-label={t(muted ? 'highlights.player.unmute' : 'highlights.player.mute')} sx={ctl}>
            {muted ? <SpeakerSlashIcon size={20} /> : <SpeakerHighIcon size={20} />}
          </ButtonBase>
          <Box component="span" sx={{ ...mono, fontSize: '0.8125rem', color: '#c4bcb9', ml: 0.75, whiteSpace: 'nowrap' }}>
            {clock(time)} / {clock(duration)}
          </Box>
          <Box sx={{ flex: 1 }} />
          <ButtonBase
            onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]!)}
            aria-label={t('highlights.player.speed', { speed })}
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
          <ButtonBase onClick={() => void share()} aria-label={t('highlights.player.share')} sx={ctl}>
            <ShareNetworkIcon size={20} />
          </ButtonBase>
          <ButtonBase
            component="a"
            href={src}
            download={downloadName ?? ''}
            aria-label={t('highlights.player.download')}
            sx={{ ...ctl, display: { xs: 'none', sm: 'inline-flex' } }}
          >
            <DownloadSimpleIcon size={20} />
          </ButtonBase>
          <ButtonBase onClick={fullscreen} aria-label={t(full ? 'highlights.player.exitFullscreen' : 'highlights.player.fullscreen')} sx={ctl}>
            {full ? <CornersInIcon size={20} /> : <CornersOutIcon size={20} />}
          </ButtonBase>
        </Box>
      </Box>
    </Box>
  );
});
