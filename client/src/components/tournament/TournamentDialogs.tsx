import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Typography, Alert, Box } from '@mui/material';
import ConfirmDialog from '../modals/ConfirmDialog';

interface TournamentDialogsProps {
  deleteOpen: boolean;
  regenerateOpen: boolean;
  resetOpen: boolean;
  startOpen: boolean;
  tournamentName?: string;
  tournamentStatus?: string;
  startWarning?: {
    requiredServers: number;
    availableServers: number;
  };
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  onRegenerateConfirm: () => void;
  onRegenerateCancel: () => void;
  onResetConfirm: () => void;
  onResetCancel: () => void;
  onStartConfirm: () => void;
  onStartCancel: () => void;
}

export const TournamentDialogs: React.FC<TournamentDialogsProps> = ({
  deleteOpen,
  regenerateOpen,
  resetOpen,
  startOpen,
  tournamentName,
  tournamentStatus,
   startWarning,
  onDeleteConfirm,
  onDeleteCancel,
  onRegenerateConfirm,
  onRegenerateCancel,
  onResetConfirm,
  onResetCancel,
  onStartConfirm,
  onStartCancel,
}) => {
  const navigate = useNavigate();

  const requiredServers = startWarning?.requiredServers ?? 0;
  const availableServers = startWarning?.availableServers ?? 0;
  const hasServerCounts = requiredServers > 0;
  const noServers = hasServerCounts && availableServers === 0;
  const insufficientServers =
    hasServerCounts && availableServers > 0 && availableServers < requiredServers;

  return (
    <>
      <ConfirmDialog
        open={deleteOpen}
        title="🗑️ Delete Tournament"
        message={
          <>
            <Typography variant="body2" color="text.secondary" paragraph>
              Are you sure you want to permanently DELETE <strong>"{tournamentName}"</strong>?
            </Typography>
            <Typography variant="body2" fontWeight={600} color="error.main" gutterBottom>
              ⚠️ This will:
            </Typography>
            <Box component="ul" sx={{ mt: 0, mb: 2, pl: 2 }}>
              <Typography component="li" variant="body2" color="text.secondary">
                End all active matches on servers
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                Remove the tournament completely
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                Delete all matches and brackets
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                Delete all match data and statistics
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                <strong>Cannot be undone</strong>
              </Typography>
            </Box>
            <Typography variant="body2" color="info.main" sx={{ fontStyle: 'italic' }}>
              💡 Note: If you just want to start over with the same tournament settings, use "Reset
              to Setup" instead.
            </Typography>
          </>
        }
        confirmLabel="Delete Permanently"
        cancelLabel="Cancel"
        onConfirm={onDeleteConfirm}
        onCancel={onDeleteCancel}
        confirmColor="error"
      />

      <ConfirmDialog
        open={regenerateOpen}
        title="🔄 Regenerate Brackets"
        message={
          tournamentStatus !== 'setup' ? (
            <>
              <Typography variant="body2" fontWeight={600} color="error.main" paragraph>
                ⚠️ WARNING: The tournament is {tournamentStatus?.toUpperCase()}!
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Regenerating brackets will <strong>DELETE ALL</strong> existing match data,
                including scores, statistics, and event history.
              </Typography>
              <Typography variant="body2" color="error.main" fontWeight={600}>
                This action cannot be undone.
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Are you absolutely sure you want to proceed?
              </Typography>
            </>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" paragraph>
                This will delete all existing matches and regenerate the bracket with the same
                settings.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Continue?
              </Typography>
            </>
          )
        }
        confirmLabel={tournamentStatus !== 'setup' ? 'YES, DELETE EVERYTHING' : 'Regenerate'}
        cancelLabel="Cancel"
        onConfirm={onRegenerateConfirm}
        onCancel={onRegenerateCancel}
        confirmColor="error"
      />

      <ConfirmDialog
        open={resetOpen}
        title="🔄 Reset to Setup"
        message={
          <>
            <Typography variant="body2" color="text.secondary" paragraph>
              Reset <strong>"{tournamentName}"</strong> back to SETUP mode?
            </Typography>
            <Typography variant="body2" fontWeight={600} gutterBottom>
              This will:
            </Typography>
            <Box component="ul" sx={{ mt: 0, mb: 2, pl: 2 }}>
              <Typography component="li" variant="body2" color="text.secondary">
                End all active matches on servers
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                Clear tournament status (back to setup)
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                Delete all matches and brackets
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                Delete all match data and statistics
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                <strong>Keep</strong> tournament settings (name, teams, format)
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                Allow you to edit settings again
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" paragraph>
              After resetting, you'll need to save again to regenerate brackets.
            </Typography>
            <Typography variant="body2" color="info.main" sx={{ fontStyle: 'italic' }}>
              💡 Note: To completely remove the tournament, use "Delete" instead.
            </Typography>
          </>
        }
        confirmLabel="Reset to Setup"
        cancelLabel="Cancel"
        onConfirm={onResetConfirm}
        onCancel={onResetCancel}
        confirmColor="warning"
      />

      <ConfirmDialog
        open={startOpen}
        title={
          noServers
            ? '⚠️ No Servers Available'
            : insufficientServers
            ? '⚠️ Not Enough Servers'
            : '⚠️ Start Tournament Without Servers?'
        }
        message={
          <>
            <Alert severity="warning" sx={{ mb: 2 }}>
              {noServers && (
                <>
                  <Typography variant="body2" fontWeight={600} gutterBottom>
                    No servers are currently available
                  </Typography>
                  <Typography variant="body2">
                    The tournament will start, but matches will be postponed until a server becomes
                    available. The system will automatically allocate matches when servers are
                    ready.
                  </Typography>
                </>
              )}
              {insufficientServers && (
                <>
                  <Typography variant="body2" fontWeight={600} gutterBottom>
                    Not enough servers to run all first-round matches concurrently
                  </Typography>
                  <Typography variant="body2">
                    You currently have <strong>{availableServers}</strong> available server
                    {availableServers === 1 ? '' : 's'}, but the first round expects{' '}
                    <strong>{requiredServers}</strong> concurrent match
                    {requiredServers === 1 ? '' : 'es'}. Some matches will queue and start later as
                    servers free up.
                  </Typography>
                </>
              )}
              {!noServers && !insufficientServers && (
                <>
                  <Typography variant="body2" fontWeight={600} gutterBottom>
                    Server availability is uncertain
                  </Typography>
                  <Typography variant="body2">
                    The tournament may start with limited or no servers available. Matches will be
                    postponed until servers become available, and will be allocated automatically
                    when they are ready.
                  </Typography>
                </>
              )}
            </Alert>
            <Typography variant="body2" color="text.secondary">
              Do you want to start the tournament anyway?
            </Typography>
          </>
        }
        confirmLabel="Yes, Start Anyway"
        cancelLabel="Check Servers"
        onConfirm={onStartConfirm}
        onCancel={() => {
          onStartCancel();
          navigate('/servers');
        }}
        confirmColor="warning"
      />
    </>
  );
};
