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
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';

interface AdminMatchControlsProps {
  serverId?: string;
  matchSlug?: string;
  matchStatus?: 'pending' | 'ready' | 'loaded' | 'live' | 'completed' | 'cancelled';
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
  matchStatus,
  onSuccess,
  onError,
}) => {
  const { t } = useTranslation();
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
    if (!serverId && action !== 'forceCancel' && action !== 'restartMatch' && action !== 'reallocateServer') {
      showError(t('adminMatchControls.noServer'));
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
        reallocateServer: matchSlug ? `/api/matches/${matchSlug}/reallocate` : '',
        forceCancel: matchSlug ? `/api/matches/${matchSlug}/force-cancel` : '',
      };

      const endpoint = endpoints[action];
      if (!endpoint) {
        throw new Error(t('adminMatchControls.unknownAction'));
      }

      const requestBody =
        action === 'restartMatch' || action === 'forceCancel' || action === 'reallocateServer'
          ? {}
          : { serverId, ...params };
      const response = await api.post(endpoint, requestBody);

      const messages: Record<string, string> = {
        pause: t('adminMatchControls.success.pause'),
        unpause: t('adminMatchControls.success.unpause'),
        swap: t('adminMatchControls.success.swap'),
        skipVeto: t('adminMatchControls.success.skipVeto'),
        restartRound: t('adminMatchControls.success.restartRound'),
        endMatch: t('adminMatchControls.success.endMatch'),
        endWarmup: t('adminMatchControls.success.endWarmup'),
        startMatch: t('adminMatchControls.success.startMatch'),
        restoreBackup: t('adminMatchControls.success.restoreBackup', {
          round: params?.round ?? '',
        }),
        addTime: t('adminMatchControls.success.addTime', { count: Number(params?.seconds ?? 0) }),
        broadcast: t('adminMatchControls.success.broadcast'),
        restartMatch: t('adminMatchControls.success.restartMatch'),
        reallocateServer: t('adminMatchControls.success.reallocateServer'),
        forceCancel: t('adminMatchControls.success.forceCancel'),
      };

      let message = messages[action] || t('adminMatchControls.success.default');

      // Show warnings if server was unreachable during force cancel
      if (action === 'forceCancel' && response.data?.warnings) {
        message += ` (${response.data.warnings.join(', ')})`;
      }

      showSuccess(message);
    } catch (err) {
      const error = err as Error;
      showError(error.message || t('adminMatchControls.commandFailed'));
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
    return <Alert severity="warning">{t('adminMatchControls.unavailable')}</Alert>;
  }

  type ConfirmAction = {
    action: string;
    icon: React.ReactNode;
    color: 'primary' | 'error' | 'warning';
    buttonColor?: 'error' | 'warning';
    variant?: 'outlined' | 'contained';
    requiresMatch?: boolean;
    disabled?: boolean;
    tooltipKey?: string;
  };

  const canReallocate = matchStatus === 'ready' || matchStatus === 'loaded';

  const confirmActions: ConfirmAction[] = [
    { action: 'pause', icon: <PauseIcon />, color: 'warning' },
    { action: 'unpause', icon: <PlayArrowIcon />, color: 'primary' },
    { action: 'swap', icon: <SwapHorizIcon />, color: 'warning' },
    { action: 'restartRound', icon: <RestartAltIcon />, color: 'warning' },
    { action: 'skipVeto', icon: <SkipNextIcon />, color: 'primary' },
    { action: 'endWarmup', icon: <FastForwardIcon />, color: 'primary' },
    { action: 'endMatch', icon: <StopIcon />, color: 'error', buttonColor: 'error' },
    {
      action: 'restartMatch',
      icon: <RestartAltIcon />,
      color: 'error',
      buttonColor: 'warning',
      requiresMatch: true,
    },
    {
      action: 'reallocateServer',
      icon: <SwapHorizIcon />,
      color: 'warning',
      buttonColor: 'warning',
      variant: 'contained',
      requiresMatch: true,
      disabled: !canReallocate,
      tooltipKey: canReallocate ? 'tooltip' : 'tooltipUnavailable',
    },
    {
      action: 'forceCancel',
      icon: <CancelIcon />,
      color: 'error',
      buttonColor: 'error',
      variant: 'contained',
      requiresMatch: true,
    },
  ];

  type InputAction = {
    action: string;
    icon: React.ReactNode;
    inputType: 'text' | 'number';
    defaultValue: string | number;
  };

  const inputActions: InputAction[] = [
    { action: 'restoreBackup', icon: <RestoreIcon />, inputType: 'number', defaultValue: 1 },
    { action: 'addTime', icon: <TimerIcon />, inputType: 'number', defaultValue: 60 },
    { action: 'broadcast', icon: <MessageIcon />, inputType: 'text', defaultValue: '' },
  ];

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} gutterBottom>
        {t('adminMatchControls.title')}
      </Typography>

      <Stack spacing={3}>
        {/* Match Control */}
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1" fontWeight={600}>
              {t('adminMatchControls.sections.matchControl')}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={1}>
              {confirmActions
                .filter((item) => !item.requiresMatch || matchSlug)
                .map((item) => (
                  <Grid size={{ xs: 6, sm: 4 }} key={item.action}>
                    <Tooltip
                      title={t(
                        `adminMatchControls.actions.${item.action}.${item.tooltipKey ?? 'tooltip'}`
                      )}
                      arrow
                    >
                      <span>
                        <Button
                          fullWidth
                          variant={item.variant ?? 'outlined'}
                          color={item.buttonColor}
                          startIcon={item.icon}
                          onClick={() =>
                            handleActionClick(
                              item.action,
                              t(`adminMatchControls.actions.${item.action}.title`),
                              t(`adminMatchControls.actions.${item.action}.description`),
                              item.color
                            )
                          }
                          disabled={executing || item.disabled}
                        >
                          {t(`adminMatchControls.actions.${item.action}.button`)}
                        </Button>
                      </span>
                    </Tooltip>
                  </Grid>
                ))}
            </Grid>
          </AccordionDetails>
        </Accordion>

        {/* Advanced Actions */}
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1" fontWeight={600}>
              {t('adminMatchControls.sections.advanced')}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={1}>
              {inputActions.map((item) => (
                <Grid size={{ xs: 6, sm: 4 }} key={item.action}>
                  <Tooltip title={t(`adminMatchControls.inputs.${item.action}.tooltip`)} arrow>
                    <span>
                      <Button
                        fullWidth
                        variant="outlined"
                        startIcon={item.icon}
                        onClick={() =>
                          handleInputActionClick(
                            item.action,
                            t(`adminMatchControls.inputs.${item.action}.title`),
                            t(`adminMatchControls.inputs.${item.action}.label`),
                            item.inputType,
                            item.defaultValue
                          )
                        }
                        disabled={executing}
                      >
                        {t(`adminMatchControls.inputs.${item.action}.button`)}
                      </Button>
                    </span>
                  </Tooltip>
                </Grid>
              ))}
            </Grid>
          </AccordionDetails>
        </Accordion>

        <Alert severity="info" sx={{ mt: 2 }}>
          <Typography variant="body2">
            <strong>{t('adminMatchControls.tipLabel')}</strong>{' '}
            {t('adminMatchControls.tip', {
              endMatch: t('adminMatchControls.actions.endMatch.button'),
              restartMatch: t('adminMatchControls.actions.restartMatch.button'),
            })}
          </Typography>
        </Alert>
      </Stack>

      {/* Confirm Dialog */}
      <Dialog open={confirmDialog.open} onClose={() => setConfirmDialog({ ...confirmDialog, open: false })}>
        <DialogTitle>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            {confirmDialog.title}
            <IconButton
              size="small"
              aria-label={t('adminMatchControls.close')}
              onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography>{confirmDialog.description}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            variant="contained"
            color={confirmDialog.color || 'primary'}
            disabled={executing}
          >
            {t('adminMatchControls.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Input Dialog */}
      <Dialog open={inputDialog.open} onClose={() => setInputDialog({ ...inputDialog, open: false })}>
        <DialogTitle>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            {inputDialog.title}
            <IconButton
              size="small"
              aria-label={t('adminMatchControls.close')}
              onClick={() => setInputDialog({ ...inputDialog, open: false })}
            >
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
          <Button onClick={() => setInputDialog({ ...inputDialog, open: false })}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleInputConfirm}
            variant="contained"
            color="primary"
            disabled={executing || !inputValue}
          >
            {t('adminMatchControls.execute')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AdminMatchControls;
