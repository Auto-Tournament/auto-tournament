import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Chip,
  Divider,
  Alert,
} from '@mui/material';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

interface ChangeItem {
  field: string;
  oldValue: string | string[];
  newValue: string | string[];
  label: string;
}

interface TournamentChangePreviewModalProps {
  open: boolean;
  changes: ChangeItem[];
  isLive: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const TournamentChangePreviewModal: React.FC<TournamentChangePreviewModalProps> = ({
  open,
  changes,
  isLive,
  onConfirm,
  onCancel,
}) => {
  const formatValue = (value: string | string[]): string => {
    if (Array.isArray(value)) {
      if (value.length === 0) return 'None';
      if (value.length <= 3) return value.join(', ');
      return `${value.length} items`;
    }
    return value || 'Not set';
  };

  const hasStructuralChanges = changes.some(
    (c) => c.field === 'type' || c.field === 'format' || c.field === 'teamIds'
  );

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1.5}>
          <CompareArrowsIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            Review Tournament Changes
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        {isLive && hasStructuralChanges && (
          <Alert severity="error" sx={{ mb: 2 }} icon={<WarningAmberIcon />}>
            <Typography variant="body2" fontWeight={600} gutterBottom>
              Tournament is LIVE!
            </Typography>
            <Typography variant="caption">
              Changing tournament type, format, or team count may require bracket regeneration.
              Consider using "Reset Tournament" to start fresh.
            </Typography>
          </Alert>
        )}

        {changes.length === 0 ? (
          <Typography variant="body2" color="text.secondary" align="center" py={3}>
            No changes detected
          </Typography>
        ) : (
          <Box>
            <Typography variant="caption" color="text.secondary" display="block" mb={2}>
              The following changes will be applied:
            </Typography>

            {changes.map((change, index) => (
              <Box key={change.field} mb={2}>
                <Box
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    bgcolor: 'action.hover',
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Typography
                    variant="caption"
                    fontWeight={600}
                    color="primary"
                    display="block"
                    mb={1.5}
                  >
                    {change.label}
                  </Typography>

                  {/* Old Value */}
                  <Box display="flex" alignItems="center" gap={1} mb={1}>
                    <Chip
                      label="BEFORE"
                      size="small"
                      sx={{
                        bgcolor: 'error.light',
                        color: 'error.contrastText',
                        fontWeight: 600,
                        fontSize: '0.65rem',
                        height: 20,
                      }}
                    />
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: 'monospace',
                        textDecoration: 'line-through',
                        color: 'text.secondary',
                      }}
                    >
                      {formatValue(change.oldValue)}
                    </Typography>
                  </Box>

                  {/* New Value */}
                  <Box display="flex" alignItems="center" gap={1}>
                    <Chip
                      label="AFTER"
                      size="small"
                      sx={{
                        bgcolor: 'success.light',
                        color: 'success.contrastText',
                        fontWeight: 600,
                        fontSize: '0.65rem',
                        height: 20,
                      }}
                    />
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      sx={{
                        fontFamily: 'monospace',
                      }}
                    >
                      {formatValue(change.newValue)}
                    </Typography>
                  </Box>
                </Box>
                {index < changes.length - 1 && <Divider sx={{ my: 2 }} />}
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button
          onClick={onConfirm}
          variant="contained"
          color={isLive && hasStructuralChanges ? 'warning' : 'primary'}
          disabled={changes.length === 0}
          autoFocus
          sx={{ ml: 'auto' }}
        >
          {isLive && hasStructuralChanges ? 'Apply Changes (Risky!)' : 'Apply Changes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TournamentChangePreviewModal;
