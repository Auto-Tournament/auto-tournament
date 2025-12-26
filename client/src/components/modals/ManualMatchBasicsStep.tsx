import React from 'react';
import {
  Box,
  Chip,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import type { Server, Team } from '../../types';
import type { MatchTemplate } from './useCreateManualMatchModal';

interface ManualMatchBasicsStepProps {
  templates: MatchTemplate[];
  selectedTemplateId: string;
  onTemplateChange: (templateId: string) => void;
  onOpenSaveTemplate: () => void;

  servers: Server[];
  serverId: string;
  onServerChange: (serverId: string) => void;
  loadingServers: boolean;
  submitAttempted: boolean;
  serverAllocation: Map<
    string,
    {
      allocatable: boolean;
      matchSlug: string | null;
      status: string | null;
      inGraceWindow: boolean;
      secondsUntilReady: number | null;
    }
  >;
  serverStatuses: Map<
    string,
    {
      status: 'online' | 'offline';
      currentMatch: string | null;
    }
  >;

  teams: Team[];
  team1Id: string;
  team2Id: string;
  onTeam1Change: (teamId: string) => void;
  onTeam2Change: (teamId: string) => void;
  loadingTeams: boolean;
}

export const ManualMatchBasicsStep: React.FC<ManualMatchBasicsStepProps> = ({
  templates,
  selectedTemplateId,
  onTemplateChange,
  onOpenSaveTemplate,
  servers,
  serverId,
  onServerChange,
  loadingServers,
  submitAttempted,
  serverAllocation,
  serverStatuses,
  teams,
  team1Id,
  team2Id,
  onTeam1Change,
  onTeam2Change,
  loadingTeams,
}) => {
  return (
    <>
      {/* Template first */}
      <Box display="flex" gap={1}>
        <TextField
          select
          label="Match template"
          value={selectedTemplateId}
          onChange={(e) => onTemplateChange(e.target.value)}
          fullWidth
          helperText={
            templates.length === 0
              ? 'No templates saved yet. Configure a match and save it as a template.'
              : 'Load a saved preset for maps, format, sides, and knife/veto settings.'
          }
        >
          <MenuItem value="">
            <em>None</em>
          </MenuItem>
          {templates.map((template) => (
            <MenuItem key={template.id} value={template.id}>
              {template.name}
            </MenuItem>
          ))}
        </TextField>
        <Box display="flex" alignItems="flex-end">
          <Chip
            label="Save current as template"
            color="primary"
            size="small"
            onClick={onOpenSaveTemplate}
            sx={{ cursor: 'pointer', fontWeight: 600 }}
          />
        </Box>
      </Box>

      {/* Server */}
      <TextField
        select
        label="Server"
        value={serverId}
        onChange={(e) => onServerChange(e.target.value)}
        fullWidth
        disabled={loadingServers || servers.length === 0}
        error={submitAttempted && !serverId}
        helperText={
          servers.length === 0
            ? 'No enabled servers available. Add a server first from the Servers page.'
            : submitAttempted && !serverId
            ? 'Server is required.'
            : 'Select a server to host this match.'
        }
      >
        {servers.map((server) => (
          <MenuItem key={server.id} value={server.id}>
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              width="100%"
            >
              <Box>
                {server.name} ({server.id})
                {serverAllocation.get(server.id)?.matchSlug && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    sx={{ mt: 0.25 }}
                  >
                    Current match: {serverAllocation.get(server.id)?.matchSlug}
                  </Typography>
                )}
              </Box>
              {(() => {
                const statusInfo = serverStatuses.get(server.id);
                const allocInfo = serverAllocation.get(server.id);

                let label = 'Unknown';
                let color: 'default' | 'success' | 'error' | 'warning' | 'info' =
                  'default';

                if (!statusInfo || statusInfo.status !== 'online') {
                  label = 'Offline';
                  color = 'error';
                } else if (!allocInfo) {
                  label = 'Online';
                  color = 'info';
                } else if (!allocInfo.allocatable) {
                  if (allocInfo.inGraceWindow) {
                    label =
                      allocInfo.secondsUntilReady && allocInfo.secondsUntilReady > 0
                        ? `Cooling down (${allocInfo.secondsUntilReady}s)`
                        : 'Cooling down';
                    color = 'warning';
                  } else if (allocInfo.matchSlug) {
                    label = 'Busy (match running)';
                    color = 'warning';
                  } else {
                    label = 'Busy';
                    color = 'warning';
                  }
                } else {
                  label = 'Available';
                  color = 'success';
                }

                return (
                  <Chip
                    size="small"
                    label={label}
                    color={color}
                    sx={{ fontWeight: 600, maxWidth: 200 }}
                  />
                );
              })()}
            </Box>
          </MenuItem>
        ))}
      </TextField>

      {/* Team 1 */}
      <TextField
        select
        label="Team 1"
        value={team1Id}
        onChange={(e) => onTeam1Change(e.target.value)}
        fullWidth
        disabled={loadingTeams || teams.length === 0}
        helperText={
          teams.length === 0
            ? 'No teams available. Create teams first on the Teams page.'
            : 'Optional – select Team 1 from existing teams, or leave empty for a generic team.'
        }
        error={false}
      >
        {teams
          .filter((team) => team.id !== team2Id)
          .map((team) => (
            <MenuItem key={team.id} value={team.id}>
              {team.name} ({team.id})
            </MenuItem>
          ))}
      </TextField>

      {/* Team 2 */}
      <TextField
        select
        label="Team 2"
        value={team2Id}
        onChange={(e) => onTeam2Change(e.target.value)}
        fullWidth
        disabled={loadingTeams || teams.length === 0}
        helperText={
          teams.length === 0
            ? 'No teams available. Create teams first on the Teams page.'
            : 'Optional – select Team 2 from existing teams, or leave empty for a generic team.'
        }
        error={false}
      >
        {teams
          .filter((team) => team.id !== team1Id)
          .map((team) => (
            <MenuItem key={team.id} value={team.id}>
              {team.name} ({team.id})
            </MenuItem>
          ))}
      </TextField>
    </>
  );
};


