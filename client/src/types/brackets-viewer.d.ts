declare module 'brackets-viewer' {
  export interface Participant {
    id: number;
    tournament_id: number;
    name: string;
  }

  export interface Match {
    id: number;
    number: number;
    stage_id: number;
    group_id: number;
    round_id: number;
    child_count: number;
    status: number;
    opponent1: {
      id?: number;
      position?: number;
      result?: string;
      score?: number;
    } | null;
    opponent2: {
      id?: number;
      position?: number;
      result?: string;
      score?: number;
    } | null;
  }

  export interface Stage {
    id: number;
    tournament_id: number;
    name: string;
    type: string;
    number: number;
  }

  export interface Group {
    id: number;
    stage_id: number;
    number: number;
  }

  export interface Round {
    id: number;
    number: number;
    stage_id: number;
    group_id: number;
  }

  export interface MatchGame {
    id: number;
    match_id: number;
    number: number;
    status: number;
    opponent1?: {
      result?: string;
      score?: number;
    } | null;
    opponent2?: {
      result?: string;
      score?: number;
    } | null;
  }

  export interface BracketData {
    stages: Stage[];
    matches: Match[];
    matchGames: MatchGame[];
    participants: Participant[];
    groups: Group[];
    rounds: Round[];
  }

  export interface RenderOptions {
    selector: HTMLElement;
    participantOriginPlacement?: string;
    separatedChildCountLabel?: boolean;
    showSlotsOrigin?: boolean;
    showLowerBracketSlotsOrigin?: boolean;
    highlightParticipantOnHover?: boolean;
    onMatchClick?: (match: Match) => void;
  }

  export function render(data: BracketData, options: RenderOptions): void;
}
