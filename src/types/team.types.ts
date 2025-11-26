/**
 * Team-related types
 */

export interface Player {
  steamId: string;
  name: string;
  avatar?: string;
}

export interface Team {
  id: string;
  name: string;
  tag?: string;
  discord_role_id?: string;
  players: string; // JSON string of Player[]
  created_at: number;
  updated_at: number;
}

export interface TeamResponse {
  id: string;
  name: string;
  tag?: string;
  discordRoleId?: string;
  players: Player[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateTeamInput {
  id: string;
  name: string;
  tag?: string;
  discordRoleId?: string;
  players: Player[];
}

export interface UpdateTeamInput {
  name?: string;
  tag?: string;
  discordRoleId?: string;
  players?: Player[];
}
