import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Divider,
  IconButton,
  Chip,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import type { MapPool, Map } from '../../types/api.types';

interface MapPoolActionsModalProps {
  open: boolean;
  mapPool: MapPool | null;
  maps: Map[];
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault?: () => void;
}

export default function MapPoolActionsModal({
  open,
  mapPool,
  maps,
  onClose,
  onEdit,
  onDelete,
  onSetDefault,
}: MapPoolActionsModalProps) {
  if (!mapPool) return null;

  const getMapDisplayName = (mapId: string): string => {
    const map = maps.find((m) => m.id === mapId);
    return map ? map.displayName : mapId;
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Box display="flex" alignItems="center" gap={1}>
            <Typography variant="h6">{mapPool.name}</Typography>
            {mapPool.isDefault && <Chip label="Default" size="small" color="primary" />}
          </Box>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Maps ({mapPool.mapIds.length})
            </Typography>
            <Box display="flex" flexWrap="wrap" gap={0.5}>
              {mapPool.mapIds.map((mapId) => (
                <Chip
                  key={mapId}
                  label={getMapDisplayName(mapId)}
                  size="small"
                  variant="outlined"
                />
              ))}
            </Box>
          </Box>
        </Box>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onEdit} variant="contained" startIcon={<EditIcon />}>
          Edit
        </Button>
        {!mapPool.isDefault && onSetDefault && (
          <Button onClick={onSetDefault} variant="outlined" startIcon={<StarBorderIcon />}>
            Set as Default
          </Button>
        )}
        {!mapPool.isDefault && (
          <Button onClick={onDelete} variant="outlined" color="error" startIcon={<DeleteIcon />}>
            Delete
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

