import { useState } from 'react';
import { api } from '../utils/api';

export interface ExecutionResult {
  serverId: string;
  serverName: string;
  success: boolean;
  error?: string;
  response?: string;
}

export const useAdminCommands = () => {
  const [executing, setExecuting] = useState(false);
  const [results, setResults] = useState<ExecutionResult[]>([]);
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
      let response;

      if (command === 'asay') {
        // Special handling for broadcast
        response = await api.post<{ success: boolean; results: ExecutionResult[] }>(
          '/api/rcon/broadcast',
          {
            serverIds,
            message: value || '',
          }
        );
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

        response = await api.post<{ success: boolean; results: ExecutionResult[] }>(
          '/api/rcon/command',
          payload
        );
      }

      if (response.success) {
        setResults(response.results || []);
        const successCount = response.results?.filter((r) => r.success).length || 0;
        const failCount = response.results?.length - successCount || 0;
        setSuccess(
          `Command executed on ${successCount} server(s)${
            failCount > 0 ? `, ${failCount} failed` : ''
          }`
        );
      } else {
        setError('Failed to execute command');
      }
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to execute command');
    } finally {
      setExecuting(false);
    }
  };

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  return {
    executing,
    results,
    error,
    success,
    executeCommand,
    clearMessages,
  };
};
