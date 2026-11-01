/**
 * The highlight player: the design system's Player, with what only the platform
 * has around it (kills on the scrubber, share, download, our translations).
 */
import { forwardRef, useMemo, useState } from 'react';
import { Box, ButtonBase, ListItemText, Menu, MenuItem } from '@mui/material';
import {
  DownloadSimpleIcon,
  MusicNotesIcon,
  ShareNetworkIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react';
import {
  EnergyBars,
  MUSIC_GAIN,
  Player,
  type ChapterInfo,
  type PlayerHandle,
} from '@auto-tournament/ui';
import { useTranslation } from 'react-i18next';
import { tokens, withAlpha } from '../../theme/tokens';
import { useSnackbar } from '../../contexts/SnackbarContext';
import type { ClipMarkers } from './media';
import { CLIP_THUMB_AT, VideoThumb } from './HighlightCard';
import { EventMark } from './EventMark';
import { autoSource, type VideoCut } from './qualitySource';

export { EnergyBars, MUSIC_GAIN };
export type { ChapterInfo };
export type HighlightPlayerHandle = PlayerHandle;

/** The viewer's overall level, kept between visits (also the admin's music samples). */
export const PLAYER_VOLUME_KEY = 'at.player.volume';
/** The level until the viewer sets one. */
export const PLAYER_VOLUME_DEFAULT = 1;

/** A song the player can play under a reel (the API's /api/game/cs2/music). */
export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  /** The label the admin gave it (drum-n-bass, phonk, …): the menu groups by it. */
  genre: string;
  /** Where it came from, for credit. */
  source?: string;
  seconds: number;
  /** Registered with YouTube Content ID: an upload with it can get a claim. */
  contentId: boolean;
  /** Evens its loudness out with the other tracks', in dB (already in the reel's mix). */
  gainDb?: number;
  /** 3 hype, 2 mid, 1 calm against the other tracks (api rateEnergy); absent until rated. */
  energy?: 1 | 2 | 3;
}

/** The genres the menu lists first, in this order; any other label after them. */
const GENRE_ORDER = [
  'drum-n-bass',
  'phonk',
  'techno-trance',
  'rock',
  'metal',
  'house',
  'deep-house',
  'future-bass',
  'electronic',
  'funk',
  'upbeat',
  'ambient',
  'pop',
  'dance',
  'beats',
  'small-emotions',
  'corporate',
  'orchestral',
  'jazz',
  'build-up-scenes',
  'dubstep',
  'pulses',
  'mystery',
  'modern-classical',
  'main-title',
];

/** Music beside a reel: the tracks to pick from and where its intro ends (0: none). */
export interface PlayerMusic {
  tracks: MusicTrack[];
  introEnd: number;
}

/** What a download can carry: the game alone, with its crowd, with the music playing, with both. */
function downloadChoices({ crowd, song }: { crowd: boolean; song: MusicTrack | null }) {
  const out: { key: string; crowd: boolean; song: MusicTrack | null }[] = [
    { key: 'clean', crowd: false, song: null },
  ];
  if (crowd) out.push({ key: 'crowd', crowd: true, song: null });
  if (song) out.push({ key: 'music', crowd: false, song });
  if (crowd && song) out.push({ key: 'crowd-music', crowd: true, song });
  return out;
}

export interface HighlightPlayerProps {
  src: string;
  /** What it is, for screen readers ("d1Ledez · 4K with the M4A1-S"). */
  label: string;
  /** A clip's kills and slow motion, drawn on the scrubber. */
  markers?: ClipMarkers | null;
  /** A reel's chapter starts, drawn as gaps in the track. */
  chapterStarts?: number[];
  /** What each chapter is (in chapterStarts' order), shown when the scrubber is hovered. */
  chapterInfo?: ChapterInfo[];
  /** The file name a download is saved as. */
  downloadName?: string;
  /** The page to share (default: this one). */
  shareUrl?: string;
  /** Music to play beside the video, picked here and mixed in only on download. */
  music?: PlayerMusic | null;
  /** The reel's crowd track (its own file), played beside it unless turned off. */
  crowd?: string | null;
  /** The lower qualities cut from `src`, highest first: a quality menu when there are any. */
  cuts?: VideoCut[];
  autoPlay?: boolean;
  onTime?: (seconds: number) => void;
}

const cutName = (c: VideoCut) => `${c.height === 2160 ? '4K' : `${c.height}p`} · ${c.fps} fps`;

const ctl = {
  width: 44,
  height: 44,
  borderRadius: '12px',
  color: '#f4edeb',
  '&:hover': { bgcolor: 'rgba(244,237,235,0.12)' },
  '&.Mui-focusVisible': { outline: `2px solid ${tokens.color.accent}`, outlineOffset: 2 },
} as const;

export const HighlightPlayer = forwardRef<HighlightPlayerHandle, HighlightPlayerProps>(
  function HighlightPlayer(
    {
      src,
      label,
      markers,
      chapterStarts,
      chapterInfo,
      downloadName,
      shareUrl,
      music,
      crowd = null,
      cuts = [],
      autoPlay,
      onTime,
    },
    ref
  ) {
    const { t } = useTranslation();
    const { showSuccess } = useSnackbar();
    const tracks = music?.tracks ?? [];
    const introEnd = music?.introEnd ?? 0;
    const [song, setSong] = useState<MusicTrack | null>(null);
    const [musicLevel, setMusicLevel] = useState(MUSIC_GAIN);
    const [downloadMenu, setDownloadMenu] = useState<HTMLElement | null>(null);
    const kills = markers?.kills ?? [];

    const labels = useMemo(
      () => ({
        play: t('videoHighlights.player.play'),
        pause: t('videoHighlights.player.pause'),
        seek: t('videoHighlights.player.seek'),
        back: t('videoHighlights.player.back'),
        forward: t('videoHighlights.player.forward'),
        mute: t('videoHighlights.player.mute'),
        unmute: t('videoHighlights.player.unmute'),
        volume: t('videoHighlights.player.volume'),
        fullscreen: t('videoHighlights.player.fullscreen'),
        exitFullscreen: t('videoHighlights.player.exitFullscreen'),
        loading: t('videoHighlights.player.buffering'),
        auto: t('videoHighlights.player.quality.auto'),
        noMusic: t('videoHighlights.player.noMusic'),
        musicVolume: t('videoHighlights.player.musicLevel'),
        energy: (level: number) => t(`videoHighlights.player.energy.${level}`),
        settings: t('videoHighlights.player.settings'),
        closeSettings: t('videoHighlights.player.closeSettings'),
        quality: t('videoHighlights.player.qualityTitle'),
        autoNow: (quality: string) => t('videoHighlights.player.autoNow', { quality }),
        speed: t('videoHighlights.player.speedTitle'),
        music: t('videoHighlights.player.music'),
        off: t('videoHighlights.player.off'),
        nowPlaying: t('videoHighlights.player.nowPlaying'),
        crowd: t('videoHighlights.player.crowd'),
        evenOut: t('videoHighlights.player.evenOut'),
      }),
      [t]
    );

    // The video file itself: pasted in Discord (or anywhere that unfurls
    // links) it plays as a video, no page in between. With the song the viewer
    // chose, mixed in at the default level (volumes are each viewer's own): asked
    // for now, so it is ready when someone opens the link.
    const share = async () => {
      const file = new URL(src, window.location.origin).href;
      const songFile = song
        ? `${file}?music=${encodeURIComponent(song.id)}&intro=${introEnd.toFixed(1)}&inline=1`
        : file;
      const url = shareUrl ?? songFile;
      if (!shareUrl && song) void fetch(url, { method: 'HEAD' }).catch(() => undefined);
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

    return (
      <Player<MusicTrack>
        ref={ref}
        src={autoSource(src, cuts)}
        label={label}
        chapterStarts={chapterStarts}
        chapterInfo={chapterInfo}
        tracks={tracks}
        // The reel's own mix of the track: its fades are in the file.
        trackSrc={(tr) => `${src}/music/${encodeURIComponent(tr.id)}?intro=${introEnd.toFixed(1)}`}
        musicShape={{ introEnd, fadeIn: 0, fadeOut: 0 }}
        genreOrder={GENRE_ORDER}
        genreLabel={(g) => t(`videoHighlights.player.genres.${g}`, { defaultValue: g })}
        crowd={crowd}
        onSong={setSong}
        onMusicLevel={setMusicLevel}
        qualities={
          cuts.length
            ? [
                { label: t('videoHighlights.player.quality.highest'), src },
                ...cuts.map((c) => ({ label: cutName(c), src: c.url })),
              ]
            : []
        }
        autoPlay={autoPlay}
        onTime={onTime}
        duration={markers?.duration}
        labels={labels}
        data-testid="highlight-player"
        renderThumb={(thumb) => <VideoThumb src={thumb} at={CLIP_THUMB_AT} />}
        hoverNote={(at) => {
          const span = markers?.duration ?? 0;
          const near = kills.findIndex((k) => Math.abs(k - at) <= span * 0.012);
          if (near < 0) return '';
          return t(
            near === kills.length - 1
              ? 'videoHighlights.player.lastKill'
              : 'videoHighlights.player.kill'
          );
        }}
        marks={(at) => (
          <>
            {markers?.slowmo && (
              <Box
                title={t('videoHighlights.player.slowmo')}
                sx={{
                  position: 'absolute',
                  left: at(markers.slowmo[0]),
                  width: `calc(${at(markers.slowmo[1])} - ${at(markers.slowmo[0])})`,
                  height: 5,
                  borderRadius: 999,
                  bgcolor: withAlpha(tokens.color.accent, 0.38),
                }}
              />
            )}
            {kills.map((k, i) => {
              const last = i === kills.length - 1;
              return (
                <EventMark
                  key={`${k}-${i}`}
                  at={at(k)}
                  kind={markers?.headshots?.[i] ? 'headshot' : 'kill'}
                  color={last ? tokens.color.accent : '#f4edeb'}
                  ring={tokens.color.accent}
                  title={t(
                    last ? 'videoHighlights.player.lastKill' : 'videoHighlights.player.kill'
                  )}
                />
              );
            })}
            {(markers?.reactions ?? [])
              .filter((r) => r.aww)
              .map((r) => (
                <EventMark
                  key={`death-${r.t}`}
                  at={at(r.t)}
                  kind="death"
                  color="#F09595"
                  title={t('videoHighlights.player.death')}
                />
              ))}
          </>
        )}
        controls={
          <>
            <ButtonBase
              onClick={() => void share()}
              aria-label={t('videoHighlights.player.share')}
              sx={ctl}
            >
              <ShareNetworkIcon size={20} />
            </ButtonBase>
            {tracks.length > 0 || crowd ? (
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
            <Menu
              anchorEl={downloadMenu}
              open={!!downloadMenu}
              onClose={() => setDownloadMenu(null)}
              disablePortal
              anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
              transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              slotProps={{ paper: { sx: { maxWidth: 340 } } }}
              data-testid="highlight-download-menu"
            >
              {downloadChoices({ crowd: !!crowd, song }).map((c) => {
                const params = [
                  c.crowd ? 'crowd=1' : null,
                  c.song
                    ? `music=${encodeURIComponent(c.song.id)}&intro=${introEnd.toFixed(1)}&level=${musicLevel.toFixed(2)}`
                    : null,
                ].filter(Boolean);
                return (
                  <MenuItem
                    key={c.key}
                    component="a"
                    href={params.length ? `${src}?${params.join('&')}` : src}
                    download={downloadName ?? ''}
                    data-testid={`highlight-download-${c.key}`}
                    onClick={() => {
                      setDownloadMenu(null);
                      if (params.length) showSuccess(t('videoHighlights.player.downloadMixing'));
                    }}
                    sx={{ gap: 1.5, alignItems: 'flex-start' }}
                  >
                    {/* What it carries at a glance: filled is in, outlined is out. */}
                    <Box
                      aria-hidden
                      sx={{
                        display: 'flex',
                        gap: 0.5,
                        pt: 0.5,
                        flex: 'none',
                        color: 'text.primary',
                      }}
                    >
                      {crowd && (
                        <UsersThreeIcon
                          size={18}
                          weight={c.crowd ? 'fill' : 'regular'}
                          style={{ opacity: c.crowd ? 1 : 0.35 }}
                        />
                      )}
                      {tracks.length > 0 && (
                        <MusicNotesIcon
                          size={18}
                          weight={c.song ? 'fill' : 'regular'}
                          style={{ opacity: c.song ? 1 : 0.35 }}
                        />
                      )}
                    </Box>
                    <ListItemText
                      primary={
                        c.song
                          ? t(
                              c.crowd
                                ? 'videoHighlights.player.downloadCrowdAndMusic'
                                : 'videoHighlights.player.downloadWith',
                              { title: c.song.title }
                            )
                          : t(
                              c.crowd
                                ? 'videoHighlights.player.downloadCrowd'
                                : 'videoHighlights.player.downloadWithout'
                            )
                      }
                      secondary={
                        c.song
                          ? c.song.contentId
                            ? t('videoHighlights.player.contentIdHint')
                            : t('videoHighlights.player.musicCredit', { artist: c.song.artist })
                          : c.crowd
                            ? t('videoHighlights.player.downloadCrowdHint')
                            : t('videoHighlights.player.downloadWithoutHint')
                      }
                      slotProps={{ secondary: { sx: { whiteSpace: 'normal' } } }}
                    />
                  </MenuItem>
                );
              })}
            </Menu>
          </>
        }
      />
    );
  }
);
