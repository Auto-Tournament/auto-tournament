/**
 * Veto system types
 */

export interface VetoState {
  matchSlug: string;
  format: 'bo1' | 'bo3' | 'bo5';
  status: 'in_progress' | 'completed';
  currentStep: number;
  totalSteps: number;
  availableMaps: string[];
  bannedMaps: string[];
  pickedMaps: Array<{
    mapName: string;
    mapNumber: number;
    sideTeam1?: 'CT' | 'T';
  }>;
  allMaps?: string[]; // Original order of all maps (for display purposes)
  actions: Array<{
    step: number;
    team: string;
    action: string;
    mapName?: string;
    side?: string;
    timestamp: string;
  }>;
  currentTurn?: string;
  currentAction?: string;
  team1Id?: string;
  team2Id?: string;
  team1Name?: string;
  team2Name?: string;
}

export interface VetoAction {
  mapName?: string;
  side?: 'CT' | 'T';
  teamSlug?: string;
}
