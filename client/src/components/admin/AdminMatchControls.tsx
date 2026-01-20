import React, { useState } from 'react';
import {
  Box,
  Button,
  TextField,
  Stack,
  Alert,
  Typography,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
} from '@mui/material';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import RestoreIcon from '@mui/icons-material/Restore';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import TimerIcon from '@mui/icons-material/Timer';
import StopIcon from '@mui/icons-material/Stop';
import MessageIcon from '@mui/icons-material/Message';
import FastForwardIcon from '@mui/icons-material/FastForward';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CloseIcon from '@mui/icons-material/Close';
import CancelIcon from '@mui/icons-material/Cancel';
import { api } from '../../utils/api';

interface AdminMatchControlsProps {
  serverId?: string;
  matchSlug?: string;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}

interface ConfirmDialogState {
  open: boolean;
  action: string | null;
  title: string;
  description: string;
  color?: 'primary' | 'error' | 'warning';
}

interface InputDialogState {
  open: boolean;
  action: string | null;
  title: string;
  label: string;
  inputType: 'text' | 'number';
  defaultValue?: string | number;
}

const AdminMatchControls: React.FC<AdminMatchControlsProps> = ({
  serverId,
  matchSlug,
  onSuccess,
  onError,
}) => {
  const [executing, setExecuting] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    open: false,
    action: null,
    title: '',
    description: '',
  });
  const [inputDialog, setInputDialog] = useState<InputDialogState>({
    open: false,
    action: null,
    title: '',
    label: '',
    inputType: 'text',
  });
  const [inputValue, setInputValue] = useState<string | number>('');

  const showError = (message: string) => {
    if (onError) {
      onError(message);
    }
  };

  const showSuccess = (message: string) => {
    if (onSuccess) {
      onSuccess(message);
    }
  };

  const executeAction = async (action: string, params?: Record<string, unknown>) => {
    // Force cancel doesn't require a server - it works even when server is offline
    if (!serverId && action !== 'forceCancel') {
      showError('No server assigned to this match');
      return;
    }

    setExecuting(true);

    try {
      const endpoints: Record<string, string> = {
        pause: '/api/rcon/force-pause',
        unpause: '/api/rcon/force-unpause',
        swap: '/api/rcon/swap-teams',
        skipVeto: '/api/rcon/skip-veto',
        restartRound: '/api/rcon/restart-round',
        endMatch: '/api/rcon/end-match',
        endWarmup: '/api/rcon/end-warmup',
        startMatch: '/api/rcon/start-match',
        restoreBackup: '/api/rcon/restore-backup',
        addTime: '/api/rcon/add-time',
        broadcast: '/api/rcon/say',
        restartMatch: matchSlug ? `/api/matches/${matchSlug}/restart` : '',
        forceCancel: matchSlug ? `/api/matches/${matchSlug}/force-cancel` : '',
      };

      const endpoint = endpoints[action];
      if (!endpoint) {
        throw new Error('Unknown action');
      }

      const requestBody = action === 'restartMatch' || action === 'forceCancel' ? {} : { serverId, ...params };
      const response = await api.post(endpoint, requestBody);

      const messages: Record<string, string> = {
        pause: 'Match paused successfully',
        unpause: 'Match unpaused successfully',
        swap: 'Teams swapped successfully',
        skipVeto: 'Veto phase skipped',
        restartRound: 'Round restarted',
        endMatch: 'Match ended successfully',
        endWarmup: 'Warmup ended',
        startMatch: 'Match started',
        restoreBackup: `Backup restored to round ${params?.round || ''}`,
        addTime: `Added ${params?.seconds || 0} seconds to round time`,
        broadcast: 'Message sent to server',
        restartMatch: 'Match restarted (ended and reloaded)',
        forceCancel: 'Match cancelled successfully',
      };

      let message = messages[action] || 'Command executed successfully';
      
      // Show warnings if server was unreachable during force cancel
      if (action === 'forceCancel' && response.data?.warnings) {
        message += ` (${response.data.warnings.join(', ')})`;
      }

      showSuccess(message);
    } catch (err) {
      const error = err as Error;
      showError(error.message || 'Failed to execute command');
    } finally {
      setExecuting(false);
      setConfirmDialog({ ...confirmDialog, open: false });
      setInputDialog({ ...inputDialog, open: false });
    }
  };

  const handleActionClick = (
    action: string,
    title: string,
    description: string,
    color?: 'primary' | 'error' | 'warning'
  ) => {
    setConfirmDialog({
      open: true,
      action,
      title,
      description,
      color,
    });
  };

  const handleInputActionClick = (
    action: string,
    title: string,
    label: string,
    inputType: 'text' | 'number',
    defaultValue?: string | number
  ) => {
    setInputDialog({
      open: true,
      action,
      title,
      label,
      inputType,
      defaultValue,
    });
    setInputValue(defaultValue || '');
  };

  const handleConfirm = () => {
    if (confirmDialog.action) {
      executeAction(confirmDialog.action);
    }
  };

  const handleInputConfirm = () => {
    if (inputDialog.action) {
      const params: Record<string, unknown> = {};
      
      if (inputDialog.action === 'restoreBackup') {
        params.round = Number(inputValue);
      } else if (inputDialog.action === 'addTime') {
        params.seconds = Number(inputValue);
      } else if (inputDialog.action === 'broadcast') {
        params.message = String(inputValue);
      }

      executeAction(inputDialog.action, params);
    }
  };

  if (!serverId && !matchSlug) {
    return (
      <Alert severity="warning">
        No server assigned to this match. Admin controls are unavailable.
      </Alert>
    );
  }

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} gutterBottom>
        Admin Controls
      </Typography>

      <Stack spacing={3}>
        {/* Match Control */}
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1" fontWeight={600}>
              Match Control
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={1}>
              <Grid size={{ xs: 6, sm: 4 }}>
                <Tooltip title="Admin pause - players cannot unpause" arrow>
                  <span>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<PauseIcon />}
                      onClick={() =>
                        handleActionClick(
                          'pause',
                          'Pause Match',
                          'This will force pause the match. Players cannot unpause.',
                          'warning'
                        )
                      }
                      disabled={executing}
                    >
                      Pause
                    </Button>
                  </span>
                </Tooltip>
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <Tooltip title="Resume match from pause" arrow>
                  <span>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<PlayArrowIcon />}
                      onClick={() =>
                        handleActionClick(
                          'unpause',
                          'Unpause Match',
                          'This will force unpause the match.',
                          'primary'
                        )
                      }
                      disabled={executing}
                    >
                      Unpause
                    </Button>
                  </span>
                </Tooltip>
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <Tooltip title="Switch teams to opposite sides (CT ↔ T)" arrow>
                  <span>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<SwapHorizIcon />}
                      onClick={() =>
                        handleActionClick(
                          'swap',
                          'Swap Teams',
                          'This will swap the teams sides (CT/T).',
                          'warning'
                        )
                      }
                      disabled={executing}
                    >
                      Swap Teams
                    </Button>
                  </span>
                </Tooltip>
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <Tooltip title="Restart current round from the beginning (resets economy)" arrow>
                  <span>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<RestartAltIcon />}
                      onClick={() =>
                        handleActionClick(
                          'restartRound',
                          'Restart Round',
                          'This will restart the current round.',
                          'warning'
                        )
                      }
                      disabled={executing}
                    >
                      Restart Round
                    </Button>
                  </span>
                </Tooltip>
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <Tooltip title="Skip map veto phase and load first map immediately" arrow>
                  <span>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<SkipNextIcon />}
                      onClick={() =>
                        handleActionClick(
                          'skipVeto',
                          'Skip Veto',
                          'This will skip the veto phase and start the match.',
                          'primary'
                        )
                      }
                      disabled={executing}
                    >
                      Skip Veto
                    </Button>
                  </span>
                </Tooltip>
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <Tooltip title="End warmup and start the match (knife round or live)" arrow>
                  <span>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<FastForwardIcon />}
                      onClick={() =>
                        handleActionClick(
                          'endWarmup',
                          'End Warmup',
                          'This will end the warmup period and start the match.',
                          'primary'
                        )
                      }
                      disabled={executing}
                    >
                      End Warmup
                    </Button>
                  </span>
                </Tooltip>
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <Tooltip title="Immediately end match and record final score" arrow>
                  <span>
                    <Button
                      fullWidth
                      variant="outlined"
                      color="error"
                      startIcon={<StopIcon />}
                      onClick={() =>
                        handleActionClick(
                          'endMatch',
                          'End Match',
                          'This will force end the match. Use with caution!',
                          'error'
                        )
                      }
                      disabled={executing}
                    >
                      End Match
                    </Button>
                  </span>
                </Tooltip>
              </Grid>
              {matchSlug && (
                <Grid size={{ xs: 6, sm: 4 }}>
                  <Tooltip title="End and reload match from scratch - all progress lost" arrow>
                    <span>
                      <Button
                        fullWidth
                        variant="outlined"
                        color="warning"
                        startIcon={<RestartAltIcon />}
                        onClick={() =>
                          handleActionClick(
                            'restartMatch',
                            'Restart Match',
                            'This will end the match and reload it from the beginning. All progress will be lost!',
                            'error'
                          )
                        }
                        disabled={executing}
                      >
                        Restart Match
                      </Button>
                    </span>
                  </Tooltip>
                </Grid>
              )}
              {matchSlug && (
                <Grid size={{ xs: 6, sm: 4 }}>
                  <Tooltip title="Cancel match even if server is offline - frees server allocation" arrow>
                    <span>
                      <Button
                        fullWidth
                        variant="contained"
                        color="error"
                        startIcon={<CancelIcon />}
                        onClick={() =>
                          handleActionClick(
                            'forceCancel',
                            'Force Cancel Match',
                            '⚠️ This will cancel the match even if the server is offline. The match will be marked as completed and the server will be freed. This action cannot be undone.',
                            'error'
                          )
                        }
                        disabled={executing}
                      >
                        Force Cancel
                      </Button>
                    </span>
                  </Tooltip>
                </Grid>
              )}
            </Grid>
          </AccordionDetails>
        </Accordion>

        {/* Advanced Actions */}
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1" fontWeight={600}>
              Advanced Actions
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={1}>
              <Grid size={{ xs: 6, sm: 4 }}>
                <Tooltip title="Load a saved round backup - restores economy and positions" arrow>
                  <span>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<RestoreIcon />}
                      onClick={() =>
                        handleInputActionClick(
                          'restoreBackup',
                          'Restore Backup',
                          'Round number to restore',
                          'number',
                          1
                        )
                      }
                      disabled={executing}
                    >
                      Restore Backup
                    </Button>
                  </span>
                </Tooltip>
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <Tooltip title="Extend current round timer (useful for technical pauses)" arrow>
                  <span>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<TimerIcon />}
                      onClick={() =>
                        handleInputActionClick(
                          'addTime',
                          'Add Round Time',
                          'Seconds to add',
                          'number',
                          60
                        )
                      }
                      disabled={executing}
                    >
                      Add Time
                    </Button>
                  </span>
                </Tooltip>
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <Tooltip title="Send a message to all players on the server" arrow>
                  <span>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<MessageIcon />}
                      onClick={() =>
                        handleInputActionClick(
                          'broadcast',
                          'Broadcast Message',
                          'Message to broadcast',
                          'text',
                          ''
                        )
                      }
                      disabled={executing}
                    >
                      Broadcast
                    </Button>
                  </span>
                </Tooltip>
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>

        <Alert severity="info" sx={{ mt: 2 }}>
          <Typography variant="body2">
            <strong>Admin tip:</strong> Use these controls carefully during live matches. Some
            actions like "End Match" and "Restart Match" cannot be undone.
          </Typography>
        </Alert>
      </Stack>

      {/* Confirm Dialog */}
      <Dialog open={confirmDialog.open} onClose={() => setConfirmDialog({ ...confirmDialog, open: false })}>
        <DialogTitle>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            {confirmDialog.title}
            <IconButton size="small" onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography>{confirmDialog.description}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}>Cancel</Button>
          <Button
            onClick={handleConfirm}
            variant="contained"
            color={confirmDialog.color || 'primary'}
            disabled={executing}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      {/* Input Dialog */}
      <Dialog open={inputDialog.open} onClose={() => setInputDialog({ ...inputDialog, open: false })}>
        <DialogTitle>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            {inputDialog.title}
            <IconButton size="small" onClick={() => setInputDialog({ ...inputDialog, open: false })}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box pt={1}>
            <TextField
              fullWidth
              label={inputDialog.label}
              type={inputDialog.inputType}
              value={inputValue}
              onChange={(e) =>
                setInputValue(
                  inputDialog.inputType === 'number' ? Number(e.target.value) : e.target.value
                )
              }
              autoFocus
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInputDialog({ ...inputDialog, open: false })}>Cancel</Button>
          <Button
            onClick={handleInputConfirm}
            variant="contained"
            color="primary"
            disabled={executing || !inputValue}
          >
            Execute
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AdminMatchControls;

