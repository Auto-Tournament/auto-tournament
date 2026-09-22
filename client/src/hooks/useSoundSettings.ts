import { useState } from 'react';
import type { SelectChangeEvent } from '@mui/material';
import { soundNotification, type NotificationSoundValue } from '../utils/soundNotification';

interface UseSoundSettingsReturn {
  isMuted: boolean;
  volume: number;
  soundFile: NotificationSoundValue;
  toggleMute: () => void;
  handleVolumeChange: (newValue: number) => void;
  handlePreviewSound: () => void;
  handleSoundChange: (event: SelectChangeEvent<string>) => void;
}

export function useSoundSettings(): UseSoundSettingsReturn {
  const [isMuted, setIsMuted] = useState(soundNotification.isMutedState());
  const [volume, setVolume] = useState(soundNotification.getVolume());
  const [soundFile, setSoundFile] = useState<NotificationSoundValue>(
    soundNotification.getSoundFile()
  );

  const toggleMute = () => {
    const newMutedState = soundNotification.toggleMute();
    setIsMuted(newMutedState);
  };

  const handleVolumeChange = (newValue: number) => {
    soundNotification.setVolume(newValue);
    setVolume(newValue);
  };

  const handlePreviewSound = () => {
    soundNotification.previewSound();
  };

  const handleSoundChange = (event: SelectChangeEvent<string>) => {
    const newSound = event.target.value as NotificationSoundValue;
    soundNotification.setSoundFile(newSound);
    setSoundFile(newSound);
  };

  return {
    isMuted,
    volume,
    soundFile,
    toggleMute,
    handleVolumeChange,
    handlePreviewSound,
    handleSoundChange,
  };
}
