import React, { useEffect, useRef } from 'react';
import type { NotificationSoundValue } from '../../utils/soundNotification';

interface MatchNotificationAudioProps {
  vetoReady: boolean;
  serverReady: boolean;
  isMuted: boolean;
  volume: number;
  soundFile: NotificationSoundValue;
}

export function MatchNotificationAudio({
  vetoReady,
  serverReady,
  isMuted,
  volume,
  soundFile,
}: MatchNotificationAudioProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previousVetoReady = useRef<boolean>(false);
  const previousServerReady = useRef<boolean>(false);

  useEffect(() => {
    const playNotification = () => {
      if (isMuted) return;
      const audio = audioRef.current;
      if (!audio) return;
      try {
        audio.currentTime = 0;
        audio.volume = volume;
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch((error) => {
            // Autoplay policies can block sound; log but don't spam the user with alerts.
            console.warn('Could not play notification sound:', error);
          });
        }
      } catch (error) {
        console.error('Error playing notification sound:', error);
      }
    };

    if (vetoReady && !previousVetoReady.current) {
      playNotification();
    }

    if (serverReady && !previousServerReady.current) {
      playNotification();
    }

    previousVetoReady.current = vetoReady;
    previousServerReady.current = serverReady;
  }, [vetoReady, serverReady, isMuted, volume]);

  return (
    <audio
      ref={audioRef}
      src={`/alerts/${soundFile}.mp3`}
      preload="auto"
      style={{ display: 'none' }}
    />
  );
}


