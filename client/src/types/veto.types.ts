/**
 * Map veto system types
 */

export type VetoActionType = 'ban' | 'pick' | 'side_pick';
export type VetoTeam = 'team1' | 'team2';
export type MapSide = 'CT' | 'T';

export interface VetoAction {
  step: number;
  team: VetoTeam;
  action: VetoActionType;
  mapName: string;
  side?: MapSide;
  timestamp: number;
}

export interface VetoMapResult {
  mapNumber: number;
  mapName: string;
  pickedBy: VetoTeam | 'decider';
  sideTeam1?: MapSide;
  sideTeam2?: MapSide;
  knifeRound: boolean;
}

export interface VetoState {
  matchSlug: string;
  format: 'bo1' | 'bo3' | 'bo5';
  status: 'pending' | 'in_progress' | 'completed';
  currentStep: number;
  totalSteps: number;
  availableMaps: string[];
  bannedMaps: string[];
  pickedMaps: VetoMapResult[];
  allMaps?: string[]; // Original order of all maps (for display purposes)
  actions: VetoAction[];
  currentTurn: VetoTeam;
  currentAction: VetoActionType;
  team1Id?: string;
  team2Id?: string;
  team1Name?: string;
  team2Name?: string;
  completedAt?: string;
}

export interface VetoStep {
  step: number;
  team: VetoTeam;
  action: VetoActionType;
  description: string;
}

export interface CS2MapData {
  name: string;
  displayName: string;
  image: string;
}
