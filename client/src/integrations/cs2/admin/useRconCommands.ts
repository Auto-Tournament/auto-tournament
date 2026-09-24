import { useState } from 'react';
import { api, useModuleTranslation } from '../../../module-sdk';
import type { RconResult, RconResultsResponse } from '../cs2.types';

/**
 * Runs an RCON command on one or more CS2 servers through CS2's own routes
 * (`/api/rcon/broadcast`, `/api/rcon/command`), and keeps the per-server
 * results and a toast message for the Admin tools section.
 */
export const useRconCommands = () => {
  const { t } = useModuleTranslation('cs2');
  const [executing, setExecuting] = useState(false);
  const [results, setResults] = useState<RconResult[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const executeCommand = async (
    serverIds: string[],
    command: string,
    value?: string
  ): Promise<void> => {
    setExecuting(true);
    setError('');
    setSuccess('');

    try {
      let response: RconResultsResponse;

      if (command === 'asay') {
        // Special handling for broadcast
        response = await api.post<RconResultsResponse>('/api/rcon/broadcast', {
          serverIds,
          message: value || '',
        });
      } else {
        // Generic command execution
        const payload: {
          serverIds: string[];
          command: string;
          message?: string;
          round?: number;
          value?: string;
          map?: string;
          name?: string;
        } = {
          serverIds,
          command,
        };

        // Add parameters based on command type
        if (command === 'restore' && value) {
          payload.round = parseInt(value, 10);
        } else if (command === 'map' && value) {
          payload.map = value;
        } else if ((command === 'team1_name' || command === 'team2_name') && value) {
          payload.name = value;
        } else if (value) {
          payload.value = value;
        }

        response = await api.post<RconResultsResponse>('/api/rcon/command', payload);
      }

      if (response.success) {
        setResults(response.results || []);
        // Build the toast from the result counts rather than showing the API's
        // (English) message, so it follows the UI language.
        const total = response.results?.length ?? 0;
        const successCount = response.results?.filter((r) => r.success).length ?? 0;
        const failCount = total - successCount;
        setSuccess(
          failCount > 0
            ? t('adminTools.toasts.commandPartial', {
                succeeded: successCount,
                failed: failCount,
                total,
              })
            : t('adminTools.toasts.commandExecuted', { count: successCount })
        );
      } else {
        setError(t('adminTools.toasts.commandFailed'));
      }
    } catch (err) {
      const error = err as Error;
      setError(error.message || t('adminTools.toasts.commandFailed'));
    } finally {
      setExecuting(false);
    }
  };

  return {
    executing,
    results,
    error,
    success,
    executeCommand,
  };
};
