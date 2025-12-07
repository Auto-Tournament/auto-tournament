import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode; // Changed from string to ReactNode to accept JSX
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmColor?: 'error' | 'warning' | 'primary' | 'secondary' | 'success';
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  confirmColor = 'error',
}) => {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="sm"
      fullWidth
      data-testid="confirm-dialog"
      PaperProps={{
        sx: {
          borderRadius: 3,
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          pb: 1,
        }}
      >
        <WarningAmberIcon
          sx={{
            color:
              confirmColor === 'error'
                ? 'error.main'
                : confirmColor === 'success'
                ? 'success.main'
                : 'warning.main',
            fontSize: 28,
          }}
        />
        <Typography component="span" variant="h6" fontWeight={600}>
          {title}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Box>{message}</Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onCancel} variant="outlined" color="inherit">
          {cancelLabel}
        </Button>
        <Button
          data-testid="confirm-dialog-confirm-button"
          onClick={onConfirm}
          variant="contained"
          color={confirmColor}
          autoFocus
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConfirmDialog;
