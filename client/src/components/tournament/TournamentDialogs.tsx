import React from 'react';
import ConfirmDialog from '../modals/ConfirmDialog';

interface TournamentDialogsProps {
  deleteOpen: boolean;
  regenerateOpen: boolean;
  resetOpen: boolean;
  startOpen: boolean;
  tournamentName?: string;
  tournamentStatus?: string;
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
  onDeleteConfirm,
  onDeleteCancel,
  onRegenerateConfirm,
  onRegenerateCancel,
  onResetConfirm,
  onResetCancel,
  onStartConfirm,
  onStartCancel,
}) => {
  return (
    <>
      <ConfirmDialog
        open={deleteOpen}
        title="🗑️ Delete Tournament"
        message={`Are you sure you want to permanently DELETE "${tournamentName}"?\n\n⚠️ This will:\n• Remove the tournament completely\n• Delete all matches and brackets\n• Delete all match data and statistics\n• Cannot be undone\n\nNote: If you just want to start over with the same tournament settings, use "Reset to Setup" instead.`}
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
          tournamentStatus !== 'setup'
            ? `⚠️ WARNING: The tournament is ${tournamentStatus?.toUpperCase()}!\n\nRegenerating brackets will DELETE ALL existing match data, including scores, statistics, and event history. This action cannot be undone.\n\nAre you absolutely sure you want to proceed?`
            : `This will delete all existing matches and regenerate the bracket with the same settings.\n\nContinue?`
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
        message={`Reset "${tournamentName}" back to SETUP mode?\n\nThis will:\n• Clear tournament status (back to setup)\n• Delete all matches and brackets\n• Delete all match data and statistics\n• Keep tournament settings (name, teams, format)\n• Allow you to edit settings again\n\nAfter resetting, you'll need to save again to regenerate brackets.\n\nNote: To completely remove the tournament, use "Delete" instead.`}
        confirmLabel="Reset to Setup"
        cancelLabel="Cancel"
        onConfirm={onResetConfirm}
        onCancel={onResetCancel}
        confirmColor="warning"
      />

      <ConfirmDialog
        open={startOpen}
        title="Start Tournament"
        message={`🚀 Ready to start the tournament?\n\nThis will:\n• Check all available servers\n• Automatically allocate servers to ready matches\n• Load matches on servers via RCON\n• Set servers to warmup mode\n• Change tournament status to IN PROGRESS\n\nMake sure all servers are online and ready before proceeding.`}
        confirmLabel="Start Tournament"
        cancelLabel="Cancel"
        onConfirm={onStartConfirm}
        onCancel={onStartCancel}
        confirmColor="success"
      />
    </>
  );
};
