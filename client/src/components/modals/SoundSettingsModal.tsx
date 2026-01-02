import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Typography,
  Select,
  MenuItem,
  Slider,
  Button,
  Stack,
  FormControl,
  InputLabel,
  SelectChangeEvent,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { NOTIFICATION_SOUNDS } from '../../utils/soundNotification';
import { useTranslation } from 'react-i18next';

interface SoundSettingsModalProps {
  open: boolean;
  onClose: () => void;
  volume: number;
  soundFile: string;
  onVolumeChange: (newValue: number) => void;
  onSoundChange: (event: SelectChangeEvent<string>) => void;
  onPreviewSound: () => void;
}

export function SoundSettingsModal({
  open,
  onClose,
  volume,
  soundFile,
  onVolumeChange,
  onSoundChange,
  onPreviewSound,
}: SoundSettingsModalProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box display="flex" alignItems="center" gap={1}>
            <VolumeUpIcon color="primary" />
            <Typography variant="h6">
              {t('soundSettingsModal.title')}
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          {/* Sound Selection */}
          <FormControl fullWidth>
            <InputLabel id="sound-select-label">
              {t('soundSettingsModal.soundSelect.label')}
            </InputLabel>
            <Select
              labelId="sound-select-label"
              value={soundFile}
              label={t('soundSettingsModal.soundSelect.label')}
              onChange={onSoundChange}
            >
              {NOTIFICATION_SOUNDS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Volume Control */}
          <Box>
            <Typography variant="body2" gutterBottom>
              {t('soundSettingsModal.volume.label', {
                percent: Math.round(volume * 100),
              })}
            </Typography>
            <Slider
              value={volume}
              onChange={(_event, newValue) => onVolumeChange(newValue)}
              min={0}
              max={1}
              step={0.05}
              marks={[
                { value: 0, label: '0%' },
                { value: 0.5, label: '50%' },
                { value: 1, label: '100%' },
              ]}
              valueLabelDisplay="auto"
              valueLabelFormat={(value) => `${Math.round(value * 100)}%`}
            />
          </Box>

          {/* Test Sound Button */}
          <Button
            variant="outlined"
            startIcon={<PlayArrowIcon />}
            onClick={onPreviewSound}
            fullWidth
          >
            {t('soundSettingsModal.testButton')}
          </Button>

          <Typography variant="caption" color="text.secondary">
            {t('soundSettingsModal.footer')}
          </Typography>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
