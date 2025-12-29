import React from 'react';
import { Autocomplete, Avatar, Box, Chip, MenuItem, TextField, Typography } from '@mui/material';
import type { Server, Team } from '../../types';
import type { PlayerDetail } from '../../types/api.types';

interface ManualMatchBasicsStepProps {
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
  team1Mode: 'existing' | 'new';
  team2Mode: 'existing' | 'new';
  onTeam1ModeChange: (mode: 'existing' | 'new') => void;
  onTeam2ModeChange: (mode: 'existing' | 'new') => void;
  playersPerTeam: number;
  players: PlayerDetail[];
  // Steam IDs of players currently in non-completed matches (pending/ready/loaded/live).
  busyPlayerIds?: Set<string>;
  team1NewPlayerIds: string[];
  onTeam1NewPlayerIdsChange: (ids: string[]) => void;
  team2NewPlayerIds: string[];
  onTeam2NewPlayerIdsChange: (ids: string[]) => void;
  team1NewName?: string;
  team2NewName?: string;
}

export const ManualMatchBasicsStep: React.FC<ManualMatchBasicsStepProps> = ({
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
  team1Mode,
  team2Mode,
  onTeam1ModeChange,
  onTeam2ModeChange,
  playersPerTeam,
  players,
  busyPlayerIds,
  team1NewPlayerIds,
  onTeam1NewPlayerIdsChange,
  team2NewPlayerIds,
  onTeam2NewPlayerIdsChange,
  team1NewName,
  team2NewName,
}) => {
  const effectiveSlots = Number.isFinite(playersPerTeam) && playersPerTeam > 0 ? playersPerTeam : 5;

  const findPlayerById = (id: string): PlayerDetail | null =>
    players.find((p) => p.id === id) || null;

  const renderNewTeamSelectors = (
    labelPrefix: string,
    slotIds: string[],
    onChange: (ids: string[]) => void,
    teamName: string | undefined,
    otherTeamIds: string[]
  ) => {
    const slots = Array.from({ length: effectiveSlots });
    return (
      <Box sx={{ mt: 1 }}>
        <Typography variant="subtitle2" gutterBottom>
          {labelPrefix} players ({slotIds.filter((id) => !!id).length}/{effectiveSlots})
        </Typography>
        <Box display="flex" flexDirection="column" gap={1}>
          {slots.map((_, index) => {
            const currentId = slotIds[index] ?? '';
            const currentPlayer = currentId ? findPlayerById(currentId) : null;
          // Prevent selecting the same player twice in a team or across both teams.
          const blockedIds = new Set<string>([...slotIds, ...otherTeamIds]);
          if (currentId) {
            blockedIds.delete(currentId);
          }
          const availableOptions = players.filter((p) => {
            if (blockedIds.has(p.id)) return false;
            if (busyPlayerIds && busyPlayerIds.has(p.id)) return false;
            return true;
          });
            return (
              <Autocomplete
                key={index}
                options={availableOptions}
                value={currentPlayer}
                onChange={(_event, newValue) => {
                  const next = [...slotIds];
                  next[index] = newValue?.id ?? '';
                  onChange(next);
                }}
                getOptionLabel={(option) =>
                  option.name ? `${option.name} (${option.id})` : option.id
                }
                // Allow searching by both player name and Steam ID.
                filterOptions={(options, state) => {
                  const q = state.inputValue.toLowerCase();
                  if (!q) return options;
                  return options.filter((option) => {
                    const name = (option.name || '').toLowerCase();
                    const id = option.id.toLowerCase();
                    return name.includes(q) || id.includes(q);
                  });
                }}
                renderOption={(props, option) => (
                  <Box
                    component="li"
                    {...props}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                  >
                    <Avatar
                      src={option.avatar}
                      alt={option.name}
                      sx={{ width: 24, height: 24, fontSize: '0.75rem' }}
                    >
                      {option.name?.charAt(0).toUpperCase() ?? option.id.charAt(0).toUpperCase()}
                    </Avatar>
                    <Box>
                      <Typography variant="body2">{option.name || option.id}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {option.id}
                      </Typography>
                    </Box>
                  </Box>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={`${labelPrefix} slot ${index + 1}`}
                    placeholder="Search by name or Steam ID…"
                  />
                )}
              />
            );
          })}
        </Box>
        {teamName && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            Random team name: {teamName}
          </Typography>
        )}
      </Box>
    );
  };

  return (
    <>
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
        value={team1Mode === 'new' ? '__new__' : team1Id}
        onChange={(e) => {
          const value = e.target.value;
          if (value === '__new__') {
            onTeam1ModeChange('new');
            onTeam1Change('');
          } else {
            onTeam1ModeChange('existing');
            onTeam1Change(value);
          }
        }}
        fullWidth
        disabled={loadingTeams}
        helperText={
          teams.length === 0
            ? 'No existing teams – using an ad-hoc team for this match.'
            : team1Mode === 'new'
            ? 'Ad-hoc team for this match only. Players are defined below.'
            : 'Optional – select Team 1 from existing teams, or choose "New team" to define players only.'
        }
        error={false}
      >
        <MenuItem value="">
          <em>None</em>
        </MenuItem>
        <MenuItem value="__new__">New team (ad-hoc)</MenuItem>
        {teams
          .filter((team) => team.id !== team2Id)
          .map((team) => (
            <MenuItem key={team.id} value={team.id}>
              {team.name} ({team.id})
            </MenuItem>
          ))}
      </TextField>
      {team1Mode === 'new' && (
        renderNewTeamSelectors(
          'Team 1',
          team1NewPlayerIds,
          onTeam1NewPlayerIdsChange,
          team1NewName,
          team2NewPlayerIds
        )
      )}

      {/* Team 2 */}
      <TextField
        select
        label="Team 2"
        value={team2Mode === 'new' ? '__new__' : team2Id}
        onChange={(e) => {
          const value = e.target.value;
          if (value === '__new__') {
            onTeam2ModeChange('new');
            onTeam2Change('');
          } else {
            onTeam2ModeChange('existing');
            onTeam2Change(value);
          }
        }}
        fullWidth
        disabled={loadingTeams}
        helperText={
          teams.length === 0
            ? 'No existing teams – using an ad-hoc team for this match.'
            : team2Mode === 'new'
            ? 'Ad-hoc team for this match only. Players are defined below.'
            : 'Optional – select Team 2 from existing teams, or choose "New team" to define players only.'
        }
        error={false}
      >
        <MenuItem value="">
          <em>None</em>
        </MenuItem>
        <MenuItem value="__new__">New team (ad-hoc)</MenuItem>
        {teams
          .filter((team) => team.id !== team1Id)
          .map((team) => (
            <MenuItem key={team.id} value={team.id}>
              {team.name} ({team.id})
            </MenuItem>
          ))}
      </TextField>
      {team2Mode === 'new' && (
        renderNewTeamSelectors(
          'Team 2',
          team2NewPlayerIds,
          onTeam2NewPlayerIdsChange,
          team2NewName,
          team1NewPlayerIds
        )
      )}
    </>
  );
};


