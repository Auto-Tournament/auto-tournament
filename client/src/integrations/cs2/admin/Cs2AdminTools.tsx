/**
 * CS2's section of the Admin tools page (slot `adminToolsSection`, client API
 * 0.2.2): RCON on its servers, and the live feed of their events.
 *
 * Both were core's Admin tools page until the module split (audit chunk 9):
 * they are about CS2 servers, so an instance without CS2 has neither. The page
 * keeps what every instance has (logs, match recovery); this is the rest.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Typography,
  Box,
  Card,
  CardContent,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  TextField,
  Alert,
  Chip,
  CircularProgress,
  Grid,
  Divider,
  Stack,
} from '@mui/material';
import { ArrowClockwiseIcon, CaretDownIcon, PlayIcon } from '@phosphor-icons/react';
import { api, radii, useModuleTranslation, useSnackbar } from '../../../module-sdk';
import type { AdminToolsSectionProps } from '../../types';
import { ADMIN_COMMAND_CATEGORIES, type AdminCommand } from './rconCommands';
import { useRconCommands } from './useRconCommands';
import { ServerEventsMonitor } from './ServerEventsMonitor';

interface RconServer {
  id: string;
  name: string;
  host: string;
  port: number;
  enabled: boolean;
}

// Shown first; the rest are under "Advanced tools", so the page is complete
// without putting every niche command up front.
const ESSENTIAL_COMMAND_IDS = new Set<string>([
  'match-end', // css_restart
  'force-pause',
  'force-unpause',
  'broadcast',
  'start-practice',
  'exit-practice',
]);

// Duplicates or legacy variants of a command shown elsewhere.
const HIDDEN_COMMAND_IDS = new Set<string>(['clean-servers']);

const ALL_COMMANDS: AdminCommand[] = ADMIN_COMMAND_CATEGORIES.flatMap(
  (category) => category.commands
);

const QUICK_COMMANDS: AdminCommand[] = ALL_COMMANDS.filter(
  (command) => ESSENTIAL_COMMAND_IDS.has(command.id) && !HIDDEN_COMMAND_IDS.has(command.id)
);

const ADVANCED_CATEGORIES = ADMIN_COMMAND_CATEGORIES.map((category) => ({
  ...category,
  commands: category.commands.filter(
    (command) => !ESSENTIAL_COMMAND_IDS.has(command.id) && !HIDDEN_COMMAND_IDS.has(command.id)
  ),
})).filter((category) => category.commands.length > 0);

export const Cs2AdminTools: React.FC<AdminToolsSectionProps> = () => {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [servers, setServers] = useState<RconServer[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>('all');
  const [loadingServers, setLoadingServers] = useState(true);
  const [commandInputs, setCommandInputs] = useState<Record<string, string>>({});
  const { executing, results, error, success, executeCommand } = useRconCommands();

  const loadServers = useCallback(async () => {
    setLoadingServers(true);
    try {
      const response: { servers: RconServer[] } = await api.get('/api/servers');
      setServers((response.servers || []).filter((s) => s.enabled));
    } catch (err) {
      console.error('Failed to load servers:', err);
    } finally {
      setLoadingServers(false);
    }
  }, []);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  useEffect(() => {
    if (success) showSuccess(success);
  }, [success, showSuccess]);

  useEffect(() => {
    if (error) showError(error);
  }, [error, showError]);

  const targetServerIds = selectedServerId === 'all' ? servers.map((s) => s.id) : [selectedServerId];

  const handleExecuteCommand = async (command: AdminCommand) => {
    const value = command.requiresInput ? commandInputs[command.id] : undefined;
    if (command.requiresInput && !value) return;
    if (targetServerIds.length === 0) return;

    await executeCommand(targetServerIds, command.command, value);

    if (command.requiresInput) {
      setCommandInputs((prev) => ({ ...prev, [command.id]: '' }));
    }
  };

  const renderCommandCard = (command: AdminCommand) => (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle2" fontWeight={600} gutterBottom>
          {t(`adminTools.commands.${command.i18nKey}.label`)}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" mb={2}>
          {t(`adminTools.commands.${command.i18nKey}.description`)}
        </Typography>

        {command.requiresInput && (
          <TextField
            fullWidth
            size="small"
            label={t(`adminTools.commands.${command.i18nKey}.inputLabel`)}
            type={command.inputType || 'text'}
            value={commandInputs[command.id] || ''}
            onChange={(e) =>
              setCommandInputs((prev) => ({ ...prev, [command.id]: e.target.value }))
            }
            sx={{ mb: 1 }}
          />
        )}

        {/* Outlined in the theme's colour, red only when the command is
            destructive. */}
        <Button
          fullWidth
          variant="outlined"
          color={command.color === 'error' ? 'error' : 'primary'}
          size="small"
          startIcon={executing ? <CircularProgress size={16} /> : <PlayIcon size={24} />}
          onClick={() => handleExecuteCommand(command)}
          disabled={
            executing ||
            servers.length === 0 ||
            (command.requiresInput && !commandInputs[command.id])
          }
        >
          {t('adminTools.command.execute')}
        </Button>

        {command.id === 'custom-rcon' && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            <Typography variant="caption">{t('adminTools.customRconWarning')}</Typography>
          </Alert>
        )}
      </CardContent>
    </Card>
  );

  return (
    <Box component="section" data-testid="cs2-admin-tools">
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        gap={2}
        mb={2}
        flexWrap="wrap"
      >
        <Box>
          <Typography variant="h5" fontWeight={600} gutterBottom>
            {t('adminTools.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('adminTools.description')}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<ArrowClockwiseIcon size={24} />}
          onClick={() => void loadServers()}
          disabled={loadingServers}
        >
          {t('adminTools.refresh')}
        </Button>
      </Stack>

      {loadingServers ? (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
          <CircularProgress />
        </Box>
      ) : (
        <>
          {/* Server selection */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Grid container spacing={2} alignItems="center">
                <Grid size={{ xs: 12, md: 8 }}>
                  <FormControl fullWidth>
                    <InputLabel>{t('adminTools.serverSelect.label')}</InputLabel>
                    <Select
                      value={selectedServerId}
                      label={t('adminTools.serverSelect.label')}
                      onChange={(e) => setSelectedServerId(e.target.value)}
                    >
                      <MenuItem value="all">
                        <Box display="flex" alignItems="center" gap={1}>
                          <Chip
                            label={t('adminTools.serverSelect.allServersChip')}
                            size="small"
                            color="primary"
                          />
                          <Typography>
                            {t('adminTools.serverSelect.allServersDescription', {
                              count: servers.length,
                            })}
                          </Typography>
                        </Box>
                      </MenuItem>
                      <Divider />
                      {servers.map((server) => (
                        <MenuItem key={server.id} value={server.id}>
                          {server.name} ({server.host}:{server.port})
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <Button
                    fullWidth
                    variant="contained"
                    color="primary"
                    onClick={() => void executeCommand(targetServerIds, 'status')}
                    disabled={executing || servers.length === 0}
                    startIcon={executing ? <CircularProgress size={16} /> : <PlayIcon size={24} />}
                  >
                    {t('adminTools.serverSelect.sendStatus')}
                  </Button>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {/* Execution results */}
          {results.length > 0 && (
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  {t('adminTools.results.title')}
                </Typography>
                <Grid container spacing={2}>
                  {results.map((result) => (
                    <Grid size={{ xs: 12 }} key={result.serverId}>
                      <Box
                        sx={{
                          p: 2,
                          borderRadius: radii.sm,
                          border: '1px solid',
                          borderColor: result.success ? 'success.main' : 'error.main',
                          bgcolor: result.success ? 'success.light' : 'error.light',
                        }}
                      >
                        <Box
                          display="flex"
                          justifyContent="space-between"
                          alignItems="center"
                          mb={1}
                        >
                          <Typography variant="body2" fontWeight={600}>
                            {result.serverName}
                          </Typography>
                          <Chip
                            label={
                              result.success
                                ? t('adminTools.results.successChip')
                                : t('adminTools.results.failedChip')
                            }
                            size="small"
                            color={result.success ? 'success' : 'error'}
                            sx={{ fontWeight: 600 }}
                          />
                        </Box>
                        {result.response && (
                          <Box
                            sx={{
                              mt: 1,
                              p: 1.5,
                              borderRadius: radii.sm,
                              bgcolor: 'background.paper',
                              border: '1px solid',
                              borderColor: 'divider',
                              fontFamily: 'monospace',
                              fontSize: '0.75rem',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              maxHeight: '300px',
                              overflowY: 'auto',
                            }}
                          >
                            {result.response}
                          </Box>
                        )}
                        {result.error && (
                          <Typography variant="caption" color="error.main" display="block" mt={1}>
                            {t('adminTools.results.errorPrefix')} {result.error}
                          </Typography>
                        )}
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              </CardContent>
            </Card>
          )}

          {/* Quick actions */}
          {QUICK_COMMANDS.length > 0 && (
            <>
              <Typography variant="h6" fontWeight={600} mb={2}>
                {t('adminTools.quickActions.title')}
              </Typography>
              <Grid container spacing={2} mb={3} data-testid="cs2-admin-tools-quick-actions">
                {QUICK_COMMANDS.map((command) => (
                  <Grid size={{ xs: 12, sm: 6, md: 4 }} key={command.id}>
                    {renderCommandCard(command)}
                  </Grid>
                ))}
              </Grid>
            </>
          )}

          {/* Advanced command categories */}
          {ADVANCED_CATEGORIES.length > 0 && (
            <>
              <Typography variant="h6" fontWeight={600} mt={1} mb={2}>
                {t('adminTools.advanced.title')}
              </Typography>
              {ADVANCED_CATEGORIES.map((category) => (
                <Accordion key={category.id}>
                  <AccordionSummary expandIcon={<CaretDownIcon size={24} />}>
                    <Typography variant="subtitle1" fontWeight={600}>
                      {t(`adminTools.categories.${category.i18nKey}`)}
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Grid container spacing={2}>
                      {category.commands.map((command) => (
                        <Grid size={{ xs: 12, sm: 6, md: 4 }} key={command.id}>
                          {renderCommandCard(command)}
                        </Grid>
                      ))}
                    </Grid>
                  </AccordionDetails>
                </Accordion>
              ))}
            </>
          )}

          {servers.length === 0 && (
            <Alert severity="info" sx={{ mt: 2 }}>
              {t('adminTools.noServers')}
            </Alert>
          )}
        </>
      )}

      {/* Server events monitor, collapsed by default */}
      <Accordion sx={{ mt: 3 }}>
        <AccordionSummary expandIcon={<CaretDownIcon size={24} />}>
          <Typography variant="h6">{t('adminTools.events.title')}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <ServerEventsMonitor />
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};
