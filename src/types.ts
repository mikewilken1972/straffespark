export type Choice = 'left' | 'center' | 'right' | null;

export interface RoundResult {
  round: number;
  kickerId: string;
  keeperId: string;
  kickerChoice: Choice;
  keeperChoice: Choice;
  isGoal: boolean;
  isSaved: boolean;
  isMissed: boolean;
}

export interface GameRoom {
  id: string;
  code: string;
  players: string[];
  playerNames: Record<string, string>;
  status: 'waiting' | 'playing' | 'finished';
  currentRound: number;
  kickerId: string;
  keeperId: string;
  kickerChoice: Choice;
  keeperChoice: Choice;
  scores: Record<string, number>;
  history: RoundResult[];
  lastUpdated: any;
  isSinglePlayer?: boolean;
}
