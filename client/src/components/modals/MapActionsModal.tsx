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
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import type { Map } from '../../types/api.types';
import { FadeInImage } from '../common/FadeInImage';

interface MapActionsModalProps {
  open: boolean;
  map: Map | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export default function MapActionsModal({
  open,
  map,
  onClose,
  onEdit,
  onDelete,
}: MapActionsModalProps) {
  if (!map) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="map-actions-modal">
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">{map.displayName}</Typography>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Map ID
            </Typography>
            <Typography variant="body1">{map.id}</Typography>
          </Box>
          {map.imageUrl && (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Preview
              </Typography>
              <FadeInImage
                src={map.imageUrl}
                alt={map.displayName}
                sx={{
                  width: '100%',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                }}
              />
            </Box>
          )}
        </Box>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button
          data-testid="map-edit-button"
          onClick={onEdit}
          variant="contained"
          startIcon={<EditIcon />}
        >
          Edit
        </Button>
        <Button onClick={onDelete} variant="outlined" color="error" startIcon={<DeleteIcon />}>
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}
