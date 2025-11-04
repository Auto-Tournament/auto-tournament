import { useState } from 'react';
import { Snackbar, Alert } from '@mui/material';
import { copyTeamMatchUrl } from '../utils/teamLinks';

/**
 * Reusable hook for copying team match links with toast notification
 */
export const useTeamLinkCopy = () => {
  const [showToast, setShowToast] = useState(false);

  const copyLink = async (teamId: string | undefined) => {
    if (!teamId) return false;
    const success = await copyTeamMatchUrl(teamId);
    if (success) {
      setShowToast(true);
    }
    return success;
  };

  const ToastNotification = () => (
    <Snackbar
      open={showToast}
      autoHideDuration={3000}
      onClose={() => setShowToast(false)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      sx={{ position: 'fixed' }}
    >
      <Alert 
        onClose={() => setShowToast(false)} 
        severity="success" 
        variant="filled"
        sx={{ width: '100%' }}
      >
        Team match link copied to clipboard!
      </Alert>
    </Snackbar>
  );

  return { copyLink, ToastNotification };
};

