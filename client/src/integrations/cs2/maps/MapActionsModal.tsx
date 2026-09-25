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
import { PencilSimpleIcon, TrashIcon, XIcon } from '@phosphor-icons/react';
import type { Map } from '../cs2.types';
import { FadeInImage } from '../common/FadeInImage';
import { useModuleTranslation, radii } from '../../../module-sdk';

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
  const { t } = useModuleTranslation('cs2');

  if (!map) return null;

  const getDefaultWebpUrlForId = (mapId: string): string =>
    `https://raw.githubusercontent.com/Auto-Tournament/cs2-server-manager/master/map_thumbnails/${mapId}.webp`;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="map-actions-modal">
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">{map.displayName}</Typography>
          <IconButton size="small" onClick={onClose}>
            <XIcon size={24} />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {t('mapActionsModal.mapId')}
            </Typography>
            <Typography variant="body1">{map.id}</Typography>
          </Box>
          {map.imageUrl && (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {t('mapActionsModal.preview')}
              </Typography>
              <FadeInImage
                src={
                  map.imageUrl && !map.imageUrl.includes('cs2-server-manager')
                    ? map.imageUrl
                    : getDefaultWebpUrlForId(map.id)
                }
                alt={map.displayName}
                sx={{
                  width: '100%',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: radii.sm,
                }}
                height={256}
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
          startIcon={<PencilSimpleIcon size={24} />}
        >
          {t('mapActionsModal.edit')}
        </Button>
        <Button onClick={onDelete} variant="outlined" color="error" startIcon={<TrashIcon size={24} />}>
          {t('common.delete')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
