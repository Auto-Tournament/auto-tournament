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
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box display="flex" alignItems="center" gap={1}>
            <VolumeUpIcon color="primary" />
            <Typography variant="h6">Sound Settings</Typography>
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
            <InputLabel id="sound-select-label">Notification Sound</InputLabel>
            <Select
              labelId="sound-select-label"
              value={soundFile}
              label="Notification Sound"
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
              Volume: {Math.round(volume * 100)}%
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
            Test Sound
          </Button>

          <Typography variant="caption" color="text.secondary">
            Sound notifications will play when your match is ready or when important events occur.
          </Typography>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
